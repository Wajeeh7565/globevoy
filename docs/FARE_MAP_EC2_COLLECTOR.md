# Fare map collector on EC2

Agreed with Mehdi and Vamsi on Nov 20, 2026: the fare map is refreshed by one full
pass every 2 days on a separate EC2 machine, instead of the Lambda's 5-minute
rolling job. Every city's fares then come from the same day, and the collector is
no longer bound by the Lambda time limit. Travelpayouts refreshes its cached
prices about weekly, so every 2 days is fresh enough.

Only the collector moves. The website backend stays on the Lambda
`globevoy-recommendations`, which keeps reading the same table.

## What runs

| Piece | File |
| --- | --- |
| Full-pass logic (same Travelpayouts query, table and pacing as the Lambda job) | `backend/services/domain/fare-map/fare-map-full-pass.js` |
| Command the machine runs | `ops/fare-map/run-full-pass.cjs` |
| Schedule: every 2 days at 07:17 UTC | `ops/fare-map/ec2/globevoy-fare-map.timer` |
| Service definition | `ops/fare-map/ec2/globevoy-fare-map.service` |
| Settings template | `ops/fare-map/ec2/fare-map.env.example` |
| Permissions for the machine | `ops/fare-map/ec2/iam-policy.json` |
| Tests | `tests/backend/fare-map-full-pass.test.cjs` |

- Priority cities (Toronto, Montreal, Vancouver) are collected first.
- Each origin and month is read to its last page (up to 34 pages, about 1,000 destinations).
- One request every 1.1 s, the same pace as the Lambda job, which has never been rate limited.
- Progress is saved after every task in `META#job` / `full-pass`, separate from the Lambda's
  `META#job` / `cursor`. Both can run during the switch-over, and a stopped pass resumes.
- A rate limit pauses for the time Travelpayouts asks, then carries on. A city code Travelpayouts
  rejects is skipped. A bad token stops the pass.

Expected length of one pass: a few hours (about 7,776 tasks, most needing 1–3 requests at
1.1 s each). The first real run will give the exact figure.

## Setup (one time)

1. **Store the Travelpayouts token in Secrets Manager** (us-east-2), as secret
   `globevoy/production/travelpayouts`, plain text. Copy the value from the Lambda's
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
7. **Turn on the schedule**:
   ```bash
   sudo cp ops/fare-map/ec2/globevoy-fare-map.service ops/fare-map/ec2/globevoy-fare-map.timer /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now globevoy-fare-map.timer
   sudo systemctl start globevoy-fare-map.service   # first pass now, without waiting
   ```

## Checking on it

- Logs: `journalctl -u globevoy-fare-map -f` (progress every 250 tasks, and a final line).
- Next run: `systemctl list-timers globevoy-fare-map.timer`.
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

`cd /opt/globevoy && sudo -u globevoy git pull`, between passes. The next timer run uses the new code.
