#!/bin/bash
# Meet Buddy — Real-time Meeting Swarm Runner
# Usage: bash run-meeting-swarm.sh <repo> [meeting-id]
#
# This script syncs meeting data and outputs analysis
# that Claude Code can act on in real-time.

REPO="${1:-axits-lab/aumiqx}"
MEETING_ID="$2"
SYNC_DIR="$HOME/.meet-buddy/meetings"
GIT_SYNC_DIR="/tmp/meet-buddy-sync"
INTERVAL=30

mkdir -p "$SYNC_DIR"

echo "[Meet Buddy Swarm] Starting real-time watch on $REPO"
echo "[Meet Buddy Swarm] Sync interval: ${INTERVAL}s"
echo "[Meet Buddy Swarm] Press Ctrl+C to stop"

# Initial clone or pull
if [ ! -d "$GIT_SYNC_DIR/.git" ]; then
  git clone --depth 1 --filter=blob:none --sparse "https://github.com/$REPO.git" "$GIT_SYNC_DIR" 2>/dev/null
  cd "$GIT_SYNC_DIR" && git sparse-checkout set meetings 2>/dev/null
else
  cd "$GIT_SYNC_DIR" && git pull 2>/dev/null
fi

PREV_LINES=0

while true; do
  cd "$GIT_SYNC_DIR" && git pull -q 2>/dev/null

  # Find the latest meeting if not specified
  if [ -z "$MEETING_ID" ]; then
    MEETING_ID=$(ls -1d meetings/*/ 2>/dev/null | sort | tail -1 | xargs basename)
  fi

  if [ -z "$MEETING_ID" ]; then
    echo "[Meet Buddy Swarm] No meetings found. Waiting..."
    sleep "$INTERVAL"
    continue
  fi

  TRANSCRIPT="meetings/$MEETING_ID/transcript.md"
  META="meetings/$MEETING_ID/meta.json"

  if [ -f "$TRANSCRIPT" ]; then
    CURR_LINES=$(wc -l < "$TRANSCRIPT")
    if [ "$CURR_LINES" -gt "$PREV_LINES" ]; then
      NEW_COUNT=$((CURR_LINES - PREV_LINES))
      echo ""
      echo "═══════════════════════════════════════════════════"
      echo "[$(date +%H:%M:%S)] NEW DATA: $NEW_COUNT new lines (total: $CURR_LINES)"
      echo "═══════════════════════════════════════════════════"
      tail -n "$NEW_COUNT" "$TRANSCRIPT"
      echo "═══════════════════════════════════════════════════"
      PREV_LINES=$CURR_LINES
    fi

    # Copy to local MCP directory
    mkdir -p "$SYNC_DIR/$MEETING_ID/screenshots"
    cp -f "$GIT_SYNC_DIR/meetings/$MEETING_ID/"*.md "$SYNC_DIR/$MEETING_ID/" 2>/dev/null
    cp -f "$GIT_SYNC_DIR/meetings/$MEETING_ID/"*.json "$SYNC_DIR/$MEETING_ID/" 2>/dev/null
    cp -f "$GIT_SYNC_DIR/meetings/$MEETING_ID/screenshots/"* "$SYNC_DIR/$MEETING_ID/screenshots/" 2>/dev/null
  fi

  # Check if meeting ended
  if [ -f "$META" ]; then
    END_TIME=$(grep -o '"endTime"' "$META" 2>/dev/null)
    if [ -n "$END_TIME" ]; then
      echo ""
      echo "══════════════════════════════════════════"
      echo "[Meet Buddy Swarm] MEETING ENDED"
      echo "══════════════════════════════════════════"
      cat "$META"
      echo ""
      echo "Final transcript: $CURR_LINES lines"
      echo "Local copy at: $SYNC_DIR/$MEETING_ID/"
      break
    fi
  fi

  sleep "$INTERVAL"
done
