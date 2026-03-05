"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var vite_1 = require("vite");
var plugin_react_1 = require("@vitejs/plugin-react");
var vite_tsconfig_paths_1 = require("vite-tsconfig-paths");
// https://vite.dev/config/
exports.default = (0, vite_1.defineConfig)({
    plugins: [
        (0, plugin_react_1.default)({
            babel: {
                plugins: [
                    'react-dev-locator',
                ],
            },
        }),
        (0, vite_tsconfig_paths_1.default)(),
    ],
    server: {
        proxy: {
            '/api': {
                target: 'http://localhost:3001',
                changeOrigin: true,
                secure: false,
                configure: function (proxy) {
                    proxy.on('error', function (err) {
                        console.log('proxy error', err);
                    });
                    proxy.on('proxyReq', function (proxyReq, req) {
                        console.log('Sending Request to the Target:', req.method, req.url);
                    });
                    proxy.on('proxyRes', function (proxyRes, req) {
                        console.log('Received Response from the Target:', proxyRes.statusCode, req.url);
                    });
                },
            }
        }
    }
});
