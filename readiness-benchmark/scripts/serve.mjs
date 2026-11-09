import server from "../.mcp-use/build/index.js";
const {url} = await server.listen(0, {host: "127.0.0.1"});
process.send(url);
process.on("disconnect", () => server.close().finally(() => process.exit()));
