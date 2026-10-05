#!/usr/bin/env bash
# Every test in tests/, in order; exits nonzero if any fails.
cd "$(dirname "$0")/.." || exit 2
fail=0; n=0
for t in tests/test-*.mjs; do
  n=$((n + 1))
  out=$(node --max-old-space-size=4096 "$t" 2>&1); code=$?
  echo "$out" | tail -1
  [ $code -ne 0 ] && { fail=$((fail + 1)); echo "$out" | grep "^FAIL" | head -5; }
done
echo "suite: $((n - fail))/$n"
exit $fail
