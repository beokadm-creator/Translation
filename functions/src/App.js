"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
var react_1 = require("react");
var lucide_react_1 = require("lucide-react");
function App() {
    var _this = this;
    var _a = (0, react_1.useState)(false), isRecording = _a[0], setIsRecording = _a[1];
    var _b = (0, react_1.useState)([]), subtitles = _b[0], setSubtitles = _b[1];
    var _c = (0, react_1.useState)(false), showSettings = _c[0], setShowSettings = _c[1];
    var _d = (0, react_1.useState)({ openai: '', gemini: '' }), apiKeys = _d[0], setApiKeys = _d[1];
    var mediaRecorderRef = (0, react_1.useRef)(null);
    var audioContextRef = (0, react_1.useRef)(null);
    var destinationRef = (0, react_1.useRef)(null);
    var streamRef = (0, react_1.useRef)(null);
    var sessionIdRef = (0, react_1.useRef)('');
    var startRecording = function () { return __awaiter(_this, void 0, void 0, function () {
        var displayStream, micStream, displaySource, micSource, combinedStream, error_1;
        var _this = this;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    _a.trys.push([0, 3, , 4]);
                    // Create new session ID
                    sessionIdRef.current = crypto.randomUUID();
                    return [4 /*yield*/, navigator.mediaDevices.getDisplayMedia({
                            video: false,
                            audio: {
                                channelCount: 2,
                                sampleRate: 48000,
                                sampleSize: 16,
                                echoCancellation: false,
                                noiseSuppression: false,
                                autoGainControl: false
                            }
                        })
                        // Get microphone audio
                    ];
                case 1:
                    displayStream = _a.sent();
                    return [4 /*yield*/, navigator.mediaDevices.getUserMedia({
                            video: false,
                            audio: {
                                channelCount: 2,
                                sampleRate: 48000,
                                sampleSize: 16,
                                echoCancellation: false,
                                noiseSuppression: false,
                                autoGainControl: false
                            }
                        })
                        // Create audio context and destination
                    ];
                case 2:
                    micStream = _a.sent();
                    // Create audio context and destination
                    audioContextRef.current = new AudioContext({ sampleRate: 48000 });
                    destinationRef.current = audioContextRef.current.createMediaStreamDestination();
                    displaySource = audioContextRef.current.createMediaStreamSource(displayStream);
                    micSource = audioContextRef.current.createMediaStreamSource(micStream);
                    displaySource.connect(destinationRef.current);
                    micSource.connect(destinationRef.current);
                    combinedStream = destinationRef.current.stream;
                    streamRef.current = combinedStream;
                    mediaRecorderRef.current = new MediaRecorder(combinedStream, {
                        mimeType: 'audio/webm;codecs=opus',
                        audioBitsPerSecond: 128000
                    });
                    mediaRecorderRef.current.ondataavailable = function (event) { return __awaiter(_this, void 0, void 0, function () {
                        var formData, response, result, newSubtitle_1, error_2;
                        return __generator(this, function (_a) {
                            switch (_a.label) {
                                case 0:
                                    if (!(event.data.size > 0)) return [3 /*break*/, 5];
                                    formData = new FormData();
                                    formData.append('audio', event.data, 'audio.webm');
                                    formData.append('sessionId', sessionIdRef.current);
                                    _a.label = 1;
                                case 1:
                                    _a.trys.push([1, 4, , 5]);
                                    return [4 /*yield*/, fetch('/api/audio/upload', {
                                            method: 'POST',
                                            body: formData
                                        })];
                                case 2:
                                    response = _a.sent();
                                    return [4 /*yield*/, response.json()];
                                case 3:
                                    result = _a.sent();
                                    if (result.success) {
                                        newSubtitle_1 = {
                                            id: crypto.randomUUID(),
                                            original: result.transcript,
                                            corrected: result.corrected,
                                            timestamp: Date.now(),
                                            status: result.corrected ? 'corrected' : 'pending'
                                        };
                                        setSubtitles(function (prev) { return __spreadArray(__spreadArray([], prev, true), [newSubtitle_1], false); });
                                    }
                                    return [3 /*break*/, 5];
                                case 4:
                                    error_2 = _a.sent();
                                    console.error('Failed to upload audio chunk:', error_2);
                                    return [3 /*break*/, 5];
                                case 5: return [2 /*return*/];
                            }
                        });
                    }); };
                    mediaRecorderRef.current.start(3000); // 3-second chunks
                    setIsRecording(true);
                    return [3 /*break*/, 4];
                case 3:
                    error_1 = _a.sent();
                    console.error('Failed to start recording:', error_1);
                    alert('오디오 캡처를 시작할 수 없습니다. 마이크 권한을 확인해주세요.');
                    return [3 /*break*/, 4];
                case 4: return [2 /*return*/];
            }
        });
    }); };
    var stopRecording = function () {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(function (track) { return track.stop(); });
        }
        if (audioContextRef.current) {
            audioContextRef.current.close();
        }
        setIsRecording(false);
    };
    return (<div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="bg-blue-600 text-white p-4 shadow-lg">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-bold">치과 강연 실시간 자막</h1>
          <div className="flex items-center gap-4">
            <button onClick={isRecording ? stopRecording : startRecording} className={"flex items-center gap-2 px-6 py-3 rounded-full font-semibold transition-all ".concat(isRecording
            ? 'bg-red-500 hover:bg-red-600'
            : 'bg-green-500 hover:bg-green-600')}>
              {isRecording ? <lucide_react_1.Square size={20}/> : <lucide_react_1.Play size={20}/>}
              {isRecording ? '중지' : '시작'}
            </button>
            <button onClick={function () { return setShowSettings(!showSettings); }} className="p-3 rounded-full bg-blue-500 hover:bg-blue-400 transition-colors">
              <lucide_react_1.Settings size={20}/>
            </button>
          </div>
        </div>
      </header>

      {/* Settings Panel */}
      {showSettings && (<div className="bg-gray-50 border-b p-4">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  OpenAI API 키
                </label>
                <input type="password" value={apiKeys.openai} onChange={function (e) { return setApiKeys(function (prev) { return (__assign(__assign({}, prev), { openai: e.target.value })); }); }} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="sk-..."/>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Gemini API 키
                </label>
                <input type="password" value={apiKeys.gemini} onChange={function (e) { return setApiKeys(function (prev) { return (__assign(__assign({}, prev), { gemini: e.target.value })); }); }} className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="AIza..."/>
              </div>
            </div>
          </div>
        </div>)}

      {/* Main Content */}
      <main className="flex-1 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="bg-white rounded-lg shadow-lg border border-gray-200 min-h-[60vh]">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-800">실시간 자막</h2>
              <p className="text-sm text-gray-600 mt-1">
                {isRecording ? '녹음 중...' : '녹음을 시작하면 자막이 여기에 표시됩니다'}
              </p>
            </div>
            <div className="p-6">
              <div className="prose max-w-none">
                <div className="text-2xl leading-relaxed text-gray-900 font-medium min-h-[40vh] max-h-[60vh] overflow-y-auto">
                  {subtitles.length === 0 ? (<p className="text-gray-400 text-center mt-20">자막이 여기에 표시됩니다</p>) : (<div className="space-y-2">
                      {subtitles.map(function (subtitle) { return (<span key={subtitle.id} className="inline">
                          <span className={"transition-all duration-300 ".concat(subtitle.status === 'corrected'
                    ? 'text-blue-600 bg-blue-50 px-1 rounded'
                    : 'text-gray-900')}>
                            {subtitle.status === 'corrected' ? subtitle.corrected : subtitle.original}
                          </span>
                          {' '}
                        </span>); })}
                    </div>)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>);
}
exports.default = App;
