"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = require("express");
var cors_1 = require("cors");
var dotenv_1 = require("dotenv");
var audio_js_1 = require("./routes/audio.js");
// load env
dotenv_1.default.config();
var app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
/** API Routes */
app.use('/api/audio', audio_js_1.default);
/** health */
app.use('/api/health', function (req, res) {
    res.status(200).json({ success: true, message: 'ok' });
});
/** error handler middleware */
app.use(function (error, _req, res) {
    res.status(500).json({ success: false, error: error.message });
});
/** 404 handler */
app.use(function (req, res) {
    res.status(404).json({ success: false, error: 'API not found' });
});
exports.default = app;
