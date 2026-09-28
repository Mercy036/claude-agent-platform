"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentTaskSchema = void 0;
const zod_1 = require("zod");
exports.AgentTaskSchema = zod_1.z.object({
    sessionId: zod_1.z.string(),
    userId: zod_1.z.string(),
    task: zod_1.z.string(),
    cwd: zod_1.z.string(),
});
//# sourceMappingURL=types.js.map