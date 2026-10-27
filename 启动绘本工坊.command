#!/bin/zsh
# 双击启动「纸间 · KDP Helper」，打开 http://127.0.0.1:3210
cd "$(dirname "$0")"
LATEST_NODE=$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)
[ -n "$LATEST_NODE" ] && export PATH="$HOME/.nvm/versions/node/$LATEST_NODE/bin:$PATH"
if curl -s -o /dev/null -m 2 http://127.0.0.1:3210; then
  echo "绘本工坊已在运行，直接打开页面。"
  open http://127.0.0.1:3210
  exit 0
fi
echo "正在启动绘本工坊…（首次约需几秒）"
nohup npm start > /tmp/kdp-helper-app.log 2>&1 &
for i in {1..30}; do
  if curl -s -o /dev/null -m 2 http://127.0.0.1:3210; then
    echo "启动完成，正在打开页面。"
    open http://127.0.0.1:3210
    exit 0
  fi
  sleep 1
done
echo "启动超时，请查看日志：/tmp/kdp-helper-app.log"
