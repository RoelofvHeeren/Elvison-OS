#!/bin/bash

# check-env.sh
# Usage: ./check-env.sh <env_file> <key1> <key2> ...

ENV_FILE=$1
shift
KEYS=$@

if [ ! -f "$ENV_FILE" ]; then
    echo "Error: $ENV_FILE not found."
    exit 1
fi

MISSING=0
for KEY in $KEYS; do
    if ! grep -q "^$KEY=" "$ENV_FILE"; then
        echo "Missing: $KEY"
        MISSING=$((MISSING + 1))
    fi
done

if [ $MISSING -eq 0 ]; then
    echo "All environment variables are set."
    exit 0
else
    echo "Summary: $MISSING variables missing."
    exit 1
fi
