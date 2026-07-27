
// Simulated browser globals
const window = {};
const parent = { postMessage: () => {} };
const document = { querySelector: () => null, getElementById: () => null };
const MutationObserver = class { observe() {} };
const setTimeout = () => {};
const console = { log: () => {}, error: () => {} };
const DecompressionStream = class { constructor() {} get writable() { return { getWriter: () => ({ write: () => {}, close: () => {} }) }; } get readable() { return { getReader: () => ({ read: () => Promise.resolve({ done: true }) }) }; } };
const TextDecoder = class { decode() { return ""; } };
const DataView = class { getUint32() { return 0; } getUint16() { return 0; } };
const Uint8Array = class { constructor() {} };
const Worker = class { addEventListener() {} };

window.EJS_player = "#game";
window.EJS_core = ${JSON.stringify(opts.core)};
window.EJS_gameUrl = ${JSON.stringify(opts.gameUrl)};
window.EJS_gameName = ${JSON.stringify(opts.gameName)};
window.EJS_gameID = ${numericGameId(opts.gameId)};
window.EJS_pathtodata = ${JSON.stringify(opts.dataPath)};
window.EJS_startOnLoaded = false;
window.EJS_startButtonName = ${JSON.stringify(
)};
window.EJS_disableAutoLang = true;
window.EJS_backgroundColor = "#020204";
window.EJS_alignStartButton = "center";
window.EJS_color = ${JSON.stringify(opts.color)};
window.EJS_threads = false;
window.EJS_ready = ()=>{try{parent.postMessage({source:"ejs",type:"ready",buildId:${JSON.stringify(opts.buildId)}},"*")}catch(_){}};
window.EJS_onGameStart = ()=>{try{parent.postMessage({source:"ejs",type:"started",buildId:${JSON.stringify(opts.buildId)}},"*")}catch(_){}};
window.EJS_biosUrl = ${JSON.stringify(opts.biosUrl)};
