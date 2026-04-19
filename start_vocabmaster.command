#!/bin/zsh

cd "/Users/rachel/Documents/我 iPad 上的文件/软件与项目/项目文件/Lydia vocabmaster" || exit 1

PID_FILE=".vocabmaster-dev.pid"
LOG_FILE=".vocabmaster-dev.log"

if [ ! -d "node_modules" ]; then
  npm install || exit 1
fi

if [ -f "$PID_FILE" ]; then
  existing_pid=$(cat "$PID_FILE")
  if kill -0 "$existing_pid" 2>/dev/null; then
    open "http://localhost:47821/"
    exit 0
  else
    rm -f "$PID_FILE"
  fi
fi

nohup npm run dev > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

# Wait until the dev server is actually listening before opening the browser.
for i in {1..30}; do
  if curl -s -o /dev/null http://localhost:47821/; then
    break
  fi
  sleep 1
done

open "http://localhost:47821/"
exit 0
