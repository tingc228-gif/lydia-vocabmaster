#!/bin/zsh

cd "/Users/rachel/Documents/我 iPad 上的文件/软件与项目/项目文件/vocabmaster" || exit 1

PID_FILE=".vocabmaster-dev.pid"
LOG_FILE=".vocabmaster-dev.log"

if [ ! -d "node_modules" ]; then
  npm install || exit 1
fi

if [ -f "$PID_FILE" ]; then
  existing_pid=$(cat "$PID_FILE")
  if kill -0 "$existing_pid" 2>/dev/null; then
    open "http://localhost:3000/"
    exit 0
  else
    rm -f "$PID_FILE"
  fi
fi

nohup npm run dev -- --open > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

sleep 2
exit 0
