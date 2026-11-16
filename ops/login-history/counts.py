"""IAM-authorized retained-window counts; no Cognito tokens or customer API access."""
import argparse
import datetime as dt
import json
import re
import subprocess
import time

TABLE = "globevoy-production-login-history"

def count_user(sub, since, now, call):
    if not re.fullmatch(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", sub):
        raise ValueError("A verified Cognito sub UUID is required")
    start = dt.datetime.fromisoformat(since.replace("Z", "+00:00"))
    if start.utcoffset() != dt.timedelta(0) or start.timestamp() > now:
        raise ValueError("since must be a past UTC timestamp")
    since = start.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    request = {"TableName": TABLE, "ConsistentRead": True, "Select": "COUNT",
               "KeyConditionExpression": "PK = :pk",
               "FilterExpression": "expiresAt > :now AND authenticatedAt >= :since",
               "ExpressionAttributeValues": {":pk": {"S": "USER#" + sub},
                   ":now": {"N": str(int(now))}, ":since": {"S": since}}}
    total = 0
    while True:
        page = call(request)
        total += page["Count"]
        if not page.get("LastEvaluatedKey"):
            break
        request["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    return {"metric": "observed_post_authentication_events", "sinceUtc": since,
            "count": total, "exactUniqueLoginCount": False,
            "scope": "unexpired retained records only; not lifetime or completed OAuth sessions"}

def aws_call(request):
    # Argument arrays avoid shell quoting and write no customer identifier to a file.
    result = subprocess.run(["aws", "dynamodb", "query", "--region", "us-east-2",
                             "--cli-input-json", json.dumps(request), "--output", "json",
                             "--no-cli-pager"], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError("DynamoDB query failed; check AWS session and authorized reader role")
    return json.loads(result.stdout)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sub", required=True, help="Verified Cognito subject, not email")
    parser.add_argument("--since", required=True, help="UTC ISO timestamp within the approved retention window")
    args = parser.parse_args()
    try:
        print(json.dumps(count_user(args.sub, args.since, time.time(), aws_call), indent=2))
    except (ValueError, RuntimeError):
        parser.exit(1, "Count unavailable: invalid input, expired AWS session or insufficient reader permission.\n")
