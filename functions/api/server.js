"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * local server entry file, for local development
 */
var app_js_1 = require("./app.js");
/**
 * start server with port
 */
var PORT = process.env.PORT || 3001;
var server = app_js_1.default.listen(PORT, function () {
    console.log("Server ready on port ".concat(PORT));
});
/**
 * close server
 */
process.on('SIGTERM', function () {
    console.log('SIGTERM signal received');
    server.close(function () {
        console.log('Server closed');
        process.exit(0);
    });
});
process.on('SIGINT', function () {
    console.log('SIGINT signal received');
    server.close(function () {
        console.log('Server closed');
        process.exit(0);
    });
});
exports.default = app_js_1.default;
