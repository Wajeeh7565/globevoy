# Fare map collector on EC2

Agreed with Mehdi and Vamsi on Nov 20, 2026: the fare map is refreshed by one full
pass every 2 days on a separate EC2 machine, instead of the Lambda's 5-minute
rolling job. Every city's fares then come from the same day, and the collector is
no longer bound by the Lambda time limit. Travelpayouts refreshes its cached
prices about weekly, so every 2 days is fresh enough.

The machine only runs while collecting: an EventBridge Scheduler schedule starts it every 2 days at 2:17 am Toronto time, it runs one pass at boot, then switches itself off. Stopped, it costs only its disk.

Only the collector moves. The website backend stays on the Lambda
`globevoy-recommendations`, which keeps reading the same table.

## What runs

| Piece | File |
| --- | --- |
| Full-pass logic (same Travelpayouts query, table and pacing as the Lambda job) | `backend/services/domain/fare-map/fare-map-full-pass.js` |
| Command the machine runs | `ops/fare-map/run-full-pass.cjs` |
| Runs a pass at every boot, then powers the machine off | `ops/fare-map/ec2/globevoy-fare-map.service` |
| Permission for the schedule to start only this machine | `ops/fare-map/ec2/scheduler-start-policy.json` |
| Settings template | `ops/fare-map/ec2/fare-map.env.example` |
| Permissions for the machine | `ops/fare-map/ec2/iam-policy.json` |
| Tests | `tests/backend/fare-map-full-pass.test.cjs` |

- Every city is treated the same: month by month, origin by origin.
- Each origin and month is read to its last page (up to 34 pages, about 1,000 destinations).
- One request every 1.1 s, the same pace as the Lambda job, which has never been rate limited.
- Progress is saved after every task in `META#job` / `full-pass`, separate from the Lambda's
  `META#job` / `cursor`. Both can run during the switch-over, and a stopped pass resumes.
- A rate limit pauses for the time Travelpayouts asks, then carries on. A city code Travelpayouts
  rejects is skipped. A bad token stops the pass.

Expected length of one pass: a few hours (about 7,776 tasks, most needing 1–3 requests at
1.1 s each). The first real run will give the exact figure.

## Date pass (more departure dates per route)

After the main pass, the same boot runs `ops/fare-map/run-date-pass.cjs` when
`FARE_MAP_DATE_PASS=on` is in `/etc/globevoy/fare-map.env`:

- For each origin of the worldwide catalogue (the same 3,587 origins as the main pass:
  972 registry origins, then 2,615 selectable airports) and month (6 months; the current one
  only while 10+ days are left) it takes the 30 cheapest routes already in the fare map and asks Travelpayouts' free month-matrix for every
  day of the month, in both directions, with stops and (where given) flight duration.
- One item per route and month: pk `D#<ORIGIN>#<YYYY-MM>`, sk `<DEST>`, dates packed in `d`,
  7-day TTL. The main `F#` rows are not touched.
- Routes collected less than 36 hours ago are skipped (one GetItem each), so resumed or
  overlapping runs send no duplicate requests.
- 250 requests a minute (the endpoint allows 300). About 223,000 requests, about 15 hours.
- It stops itself after 15 hours (`--max-minutes 900`) and resumes at the next boot from
  `META#job` / `date-pass`. The service's 30-hour limit and power-off still apply.
- The trip search reads it per route with `FARE_MAP_ROUTE_DATES=on` (GetItem, at most 24 a search).

Turn it off with `FARE_MAP_DATE_PASS=off` in the settings file; nothing else changes.

## Setup (one time)

1. **Store the Travelpayouts token in Secrets Manager** (us-east-2), as secret
   `globevoy/production/travelpayouts`, plain text or a single key/value pair. Copy the value from the Lambda's
   `TRAVELPAYOUTS_TOKEN` environment variable. Never paste it into chat, Jira or Git.
2. **Create the IAM role** `globevoy-fare-map-collector` for EC2 with the policy in
   `ops/fare-map/ec2/iam-policy.json` (write and read the fare map table, read that one secret).
   Add `AmazonSSMManagedInstanceCore` so the machine can be reached through Session Manager
   without SSH keys or open ports.
3. **Launch the instance**: us-east-2, Amazon Linux 2023, 2 vCPUs and 8 GB (for example
   `t3.large`), the role from step 2, no inbound ports. Name it `globevoy-fare-map-collector`.
   **The existing Deaf AI instance must not be touched**: do not stop, restart, resize or edit it,
   and do not reuse its IAM role, security group or key pair. The collector gets its own role
   and its own security group (no inbound rules), and its policy grants nothing on EC2.
4. **Install** (through Session Manager):
   The repository is private, so first add a **read-only deploy key** for the machine
   (GitHub → repository Settings → Deploy keys, "Allow write access" unticked), with the
   private half created on the machine itself (`ssh-keygen -t ed25519`). Then:
   ```bash
   sudo dnf install -y nodejs22 git
   sudo useradd --system --home /opt/globevoy globevoy
   sudo git clone git@github.com:Wajeeh7565/globevoy.git /opt/globevoy
   cd /opt/globevoy && sudo npm install --no-save @aws-sdk/client-dynamodb@3.922.0 @aws-sdk/client-secrets-manager
   sudo chown -R globevoy /opt/globevoy
   ```
5. **Settings**: copy `ops/fare-map/ec2/fare-map.env.example` to `/etc/globevoy/fare-map.env`
   (`chmod 600`). Copy `TRAVELPAYOUTS_PRICE_CURRENCY`, `RUB_TO_USD` and `CAD_TO_USD` from the
   Lambda's environment variables, so prices are converted the same way; leave out any the Lambda
   does not set.
6. **Try it without writing anything**:
   ```bash
   cd /opt/globevoy && sudo -u globevoy env $(sudo cat /etc/globevoy/fare-map.env | xargs) node ops/fare-map/run-full-pass.cjs --dry-run --max-tasks 3
   ```
   Each line of output is JSON; `"event":"paused"` with `done: 3` means it works.
7. **Run a pass at every boot, then power off**:
   ```bash
   sudo cp ops/fare-map/ec2/globevoy-fare-map.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable globevoy-fare-map.service
   ```
8. **Start the machine every 2 days** (from CloudShell): create the role
   `globevoy-fare-map-scheduler` (trusted by `scheduler.amazonaws.com`) with
   `ops/fare-map/ec2/scheduler-start-policy.json`, which can start only this instance, then:
   ```bash
   aws scheduler create-schedule --name globevoy-fare-map-collector \
     --schedule-expression 'cron(17 2 */2 * ? *)' --schedule-expression-timezone America/Toronto \
     --flexible-time-window Mode=OFF \
     --target '{"Arn":"arn:aws:scheduler:::aws-sdk:ec2:startInstances","RoleArn":"arn:aws:iam::216241083409:role/globevoy-fare-map-scheduler","Input":"{\"InstanceIds\":[\"i-0d13709c171561f0a\"]}"}'
   ```

**Maintenance:** start the machine (a pass begins), connect through Session Manager and run
`sudo touch /etc/globevoy/hold`. The machine then stays on when the pass ends or is stopped, and
later boots skip the pass. Run `sudo rm /etc/globevoy/hold` and stop the machine when done.

## Checking on it

- Logs (while it runs): `journalctl -u globevoy-fare-map -f`; after a pass, `journalctl -u globevoy-fare-map -b -1`.
- Next run: EventBridge Scheduler → Schedules → `globevoy-fare-map-collector`. Between passes the
  instance shows **stopped** in EC2; that is normal.
- Progress in DynamoDB: Query `globevoy-fare-map` with partition key `META#job`; the `full-pass`
  item shows `index`, `done`, `skipped`, `completedAt` and `lastError`.

## Switch-over

1. Let the EC2 machine finish one full pass while the Lambda job keeps running.
2. Compare: the `full-pass` item should show about 7,776 tasks done; Query a few partitions
   (for example `F#YTO#2026-12`) and check prices and destination counts look the same as before.
3. Run a few trip searches on globevoy.com/?farePreview=1.
4. Then disable the EventBridge rule that runs the Lambda every 5 minutes. Keep the rule (disabled)
   for a few weeks so it can be switched back on in a minute if needed. The Lambda itself stays: it
   serves the website.

## Updating the collector

During a pass or with the hold file in place: `cd /opt/globevoy && sudo -u globevoy -H git pull`. The next pass uses the new code.
