#!/bin/zsh

cd "/Users/rachel/Documents/我 iPad 上的文件/软件与项目/项目文件/vocabmaster" || exit 1

PID_FILE=".vocabmaster-dev.pid"
ports=(3000 3001 3002 3003 3004 3005 3006 3007 3008 3009 3010)

found=0

if [ -f "$PID_FILE" ]; then
  pid=$(cat "$PID_FILE")
  if kill -0 "$pid" 2>/dev/null; then
    echo "Stopping VocabMaster background server: $pid"
    kill "$pid" 2>/dev/null
    found=1
  fi
  rm -f "$PID_FILE"
fi

for port in "${ports[@]}"; do
  pids=$(lsof -ti tcp:$port 2>/dev/null)
  if [ -n "$pids" ]; then
    found=1
    echo "Stopping process on port $port: $pids"
    kill $pids 2>/dev/null
  fi
done

if [ $found -eq 0 ]; then
  echo "No local VocabMaster server was found on ports 3000-3010."
else
  echo "VocabMaster local server stopped."
fi

echo
read -k 1 "?Press any key to close..."
echo
