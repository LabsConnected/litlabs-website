// Compatibility shim — legacy "Jarvis" naming now delegates to LiTT.
export {
  askLiTTCode as askJarvis,
  handleLiTTCodeCommand as handleJarvisCommand,
} from "./litt-code";
