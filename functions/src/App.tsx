import { useState, useRef, useCallback } from 'react'
import { Play, Square, Settings } from 'lucide-react'

interface SubtitleEntry {
  id: string
  original: string
  corrected?: string
  timestamp: number
  status: 'pending' | 'corrected'
}

function App() {
  const [isRecording, setIsRecording] = useState(false)
  const [subtitles, setSubtitles] = useState<SubtitleEntry[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [apiKeys, setApiKeys] = useState({ openai: '', gemini: '' })
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const destinationRef = useRef<MediaStreamAudioDestinationNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const sessionIdRef = useRef<string>('')

  const startRecording = async () => {
    try {
      // Create new session ID
      sessionIdRef.current = crypto.randomUUID()
      
      // Get system audio via display media
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
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
      const micStream = await navigator.mediaDevices.getUserMedia({
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
      audioContextRef.current = new AudioContext({ sampleRate: 48000 })
      destinationRef.current = audioContextRef.current.createMediaStreamDestination()
      
      // Connect both streams to destination
      const displaySource = audioContextRef.current.createMediaStreamSource(displayStream)
      const micSource = audioContextRef.current.createMediaStreamSource(micStream)
      
      displaySource.connect(destinationRef.current)
      micSource.connect(destinationRef.current)
      
      // Create media recorder with 3-second chunks
      const combinedStream = destinationRef.current.stream
      streamRef.current = combinedStream
      
      mediaRecorderRef.current = new MediaRecorder(combinedStream, {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 128000
      })
      
      mediaRecorderRef.current.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          const formData = new FormData()
          formData.append('audio', event.data, 'audio.webm')
          formData.append('sessionId', sessionIdRef.current)
          
          try {
            const response = await fetch('/api/audio/upload', {
              method: 'POST',
              body: formData
            })
            
            const result = await response.json()
            if (result.success) {
              const newSubtitle: SubtitleEntry = {
                id: crypto.randomUUID(),
                original: result.transcript,
                corrected: result.corrected,
                timestamp: Date.now(),
                status: result.corrected ? 'corrected' : 'pending'
              }
              
              setSubtitles(prev => [...prev, newSubtitle])
            }
          } catch (error) {
            console.error('Failed to upload audio chunk:', error)
          }
        }
      }
      
      mediaRecorderRef.current.start(3000) // 3-second chunks
      setIsRecording(true)
      
    } catch (error) {
      console.error('Failed to start recording:', error)
      alert('오디오 캡처를 시작할 수 없습니다. 마이크 권한을 확인해주세요.')
    }
  }
  
  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close()
    }
    
    setIsRecording(false)
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="bg-blue-600 text-white p-4 shadow-lg">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-2xl font-bold">치과 강연 실시간 자막</h1>
          <div className="flex items-center gap-4">
            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={`flex items-center gap-2 px-6 py-3 rounded-full font-semibold transition-all ${
                isRecording 
                  ? 'bg-red-500 hover:bg-red-600' 
                  : 'bg-green-500 hover:bg-green-600'
              }`}
            >
              {isRecording ? <Square size={20} /> : <Play size={20} />}
              {isRecording ? '중지' : '시작'}
            </button>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="p-3 rounded-full bg-blue-500 hover:bg-blue-400 transition-colors"
            >
              <Settings size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* Settings Panel */}
      {showSettings && (
        <div className="bg-gray-50 border-b p-4">
          <div className="max-w-6xl mx-auto">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  OpenAI API 키
                </label>
                <input
                  type="password"
                  value={apiKeys.openai}
                  onChange={(e) => setApiKeys(prev => ({ ...prev, openai: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="sk-..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Gemini API 키
                </label>
                <input
                  type="password"
                  value={apiKeys.gemini}
                  onChange={(e) => setApiKeys(prev => ({ ...prev, gemini: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="AIza..."
                />
              </div>
            </div>
          </div>
        </div>
      )}

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
                  {subtitles.length === 0 ? (
                    <p className="text-gray-400 text-center mt-20">자막이 여기에 표시됩니다</p>
                  ) : (
                    <div className="space-y-2">
                      {subtitles.map((subtitle) => (
                        <span key={subtitle.id} className="inline">
                          <span className={`transition-all duration-300 ${
                            subtitle.status === 'corrected' 
                              ? 'text-blue-600 bg-blue-50 px-1 rounded' 
                              : 'text-gray-900'
                          }`}>
                            {subtitle.status === 'corrected' ? subtitle.corrected : subtitle.original}
                          </span>
                          {' '}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App