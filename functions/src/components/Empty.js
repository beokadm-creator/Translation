"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Empty;
var utils_1 = require("@/lib/utils");
// Empty component
function Empty() {
    return (<div className={(0, utils_1.cn)('flex h-full items-center justify-center')}>Empty</div>);
}
