// Compatibility shim — legacy "Jarvis" naming now delegates to LiTT-Code.
export {
  askLiTTCode as askJarvis,
  handleLiTTCodeCommand as handleJarvisCommand,
} from "@litt/agent-core";
