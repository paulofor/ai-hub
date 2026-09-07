FROM busybox:1.36

CMD ["sh", "-c", "echo fixture-ready; trap 'exit 0' TERM INT; while :; do sleep 1; done"]
