"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBlockedCommand = isBlockedCommand;
exports.sanitizeEnv = sanitizeEnv;
exports.redactSecrets = redactSecrets;
const BLOCKED_PATTERNS = [
    "rm -rf /",
    "rm -rf /*",
    "mkfs",
    ":(){ :|:& };:",
    "shutdown",
    "reboot",
    "halt",
    "dd if=/dev/zero",
    "chmod -R 777 /",
    "chown -R 0:0 /",
    "> /dev/sda",
    "curl | bash",
    "wget | bash",
    "curl | sh",
    "wget | sh",
];
function isBlockedCommand(input) {
    const normalized = input.toLowerCase();
    return BLOCKED_PATTERNS.some((pattern) => normalized.includes(pattern.toLowerCase()));
}
function sanitizeEnv(value) {
    return value.replace(/[^a-zA-Z0-9_\-\.:\/=@\s]/g, "");
}
function redactSecrets(output) {
    const patterns = [
        /(sk-[a-zA-Z0-9]{20,})/g,
        /(OPENROUTER_API_KEY=)[^\s&]*/g,
        /(CLERK_SECRET_KEY=)[^\s&]*/g,
        /(AUTH_SECRET=)[^\s&]*/g,
        /(SUPERMEMORY_API_KEY=)[^\s&]*/g,
        /(DATABASE_URL=)[^\s&]*/g,
    ];
    let result = output;
    for (const pattern of patterns) {
        result = result.replace(pattern, "$1***REDACTED***");
    }
    return result;
}
