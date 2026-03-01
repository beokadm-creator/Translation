"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useTheme = useTheme;
var react_1 = require("react");
function useTheme() {
    var _a = (0, react_1.useState)(function () {
        var savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            return savedTheme;
        }
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }), theme = _a[0], setTheme = _a[1];
    (0, react_1.useEffect)(function () {
        document.documentElement.classList.remove('light', 'dark');
        document.documentElement.classList.add(theme);
        localStorage.setItem('theme', theme);
    }, [theme]);
    var toggleTheme = function () {
        setTheme(function (prevTheme) { return prevTheme === 'light' ? 'dark' : 'light'; });
    };
    return {
        theme: theme,
        toggleTheme: toggleTheme,
        isDark: theme === 'dark'
    };
}
