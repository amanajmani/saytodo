import Foundation
import Speech
import AVFoundation

class SpeechHelper: NSObject {
    let audioEngine = AVAudioEngine()
    var recognizer: SFSpeechRecognizer?
    var request: SFSpeechAudioBufferRecognitionRequest?
    var task: SFSpeechRecognitionTask?

    override init() {
        self.recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
        super.init()
    }

    func start() {
        // Check recognizer availability
        guard let recognizer = recognizer else {
            FileHandle.standardError.write("ERROR:no_recognizer\n".data(using: .utf8)!)
            exit(1)
            return
        }

        if !recognizer.isAvailable {
            FileHandle.standardError.write("ERROR:recognizer_unavailable\n".data(using: .utf8)!)
            // Still try - it might become available
        }

        SFSpeechRecognizer.requestAuthorization { status in
            switch status {
            case .authorized:
                FileHandle.standardError.write("STATUS:authorized\n".data(using: .utf8)!)
                self.startRecognition()
            case .denied:
                FileHandle.standardError.write("ERROR:speech_denied\n".data(using: .utf8)!)
                exit(1)
            case .restricted:
                FileHandle.standardError.write("ERROR:speech_restricted\n".data(using: .utf8)!)
                exit(1)
            case .notDetermined:
                FileHandle.standardError.write("ERROR:speech_not_determined\n".data(using: .utf8)!)
                exit(1)
            @unknown default:
                FileHandle.standardError.write("ERROR:speech_unknown\n".data(using: .utf8)!)
                exit(1)
            }
        }
    }

    func startRecognition() {
        request = SFSpeechAudioBufferRecognitionRequest()
        guard let request = request, let recognizer = recognizer else {
            FileHandle.standardError.write("ERROR:setup_failed\n".data(using: .utf8)!)
            return
        }
        request.shouldReportPartialResults = true

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
            request.append(buffer)
        }

        task = recognizer.recognitionTask(with: request) { result, error in
            if let result = result {
                let text = result.bestTranscription.formattedString
                let isFinal = result.isFinal
                // Escape text for JSON
                let escaped = text
                    .replacingOccurrences(of: "\\", with: "\\\\")
                    .replacingOccurrences(of: "\"", with: "\\\"")
                    .replacingOccurrences(of: "\n", with: "\\n")
                let json = "{\"text\":\"\(escaped)\",\"final\":\(isFinal)}"
                print(json)
                fflush(stdout)
            }
            if let error = error {
                let nsError = error as NSError
                // 216 = request cancelled, 209 = cancelled, 1 = generic
                if nsError.code != 216 && nsError.code != 209 {
                    FileHandle.standardError.write("ERROR:\(nsError.code):\(error.localizedDescription)\n".data(using: .utf8)!)
                }
            }
        }

        do {
            audioEngine.prepare()
            try audioEngine.start()
            FileHandle.standardError.write("READY\n".data(using: .utf8)!)
        } catch {
            FileHandle.standardError.write("ERROR:audio_failed:\(error.localizedDescription)\n".data(using: .utf8)!)
            exit(1)
        }
    }

    func stop() {
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil
    }
}

let helper = SpeechHelper()

signal(SIGTERM) { _ in
    exit(0)
}

signal(SIGINT) { _ in
    exit(0)
}

helper.start()
RunLoop.main.run()
