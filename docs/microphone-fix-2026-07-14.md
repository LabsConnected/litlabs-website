# Microphone Fix - Random Text Prevention

## Issue
The microphone/speech recognition was capturing and sending random text, likely from:
- Background noise being interpreted as speech
- Short/partial transcriptions being immediately sent
- Low-confidence speech recognition results being processed
- Push-to-talk mode still auto-sending after user stopped recording

## Changes Applied to `src/components/dashboard/LiTTTerminal.tsx`

### 1. Added Quality Filtering (lines 852-861)
```typescript
const isMeaningfulTranscript = (transcript: string, confidence?: number): boolean => {
  const MIN_LENGTH = 2; // Must be at least 2 characters
  const MIN_CONFIDENCE = 0.6; // Must have at least 60% confidence if available
  
  const trimmed = transcript.trim();
  if (trimmed.length < MIN_LENGTH) return false;
  if (confidence !== undefined && confidence < MIN_CONFIDENCE) return false;
  return true;
};
```
**Purpose**: Filters out background noise, short sounds, and low-confidence transcriptions.

### 2. Fixed Continuous Mode (line 848)
```typescript
rec.continuous = Boolean(continuousMode);
```
**Purpose**: Only enables continuous mode when the feature is actually turned on, not always.

### 3. Added Intentional Stop Detection (lines 980, 897-905)
```typescript
// In stopMic():
intentionalStopRef.current = true; // Mark that user intentionally stopped

// In speech recognition handler:
if (intentionalStopRef.current) {
  intentionalStopRef.current = false; // Reset flag
  addLog({
    type: "system",
    text: "Voice input captured. Press Enter to send or continue speaking.",
  });
  return; // Don't auto-send when user was using push-to-talk
}
```
**Purpose**: When using push-to-talk (press and hold mic button), releasing the button won't auto-send the message. Instead, it shows a message telling you to review and manually send with Enter if desired.

### 4. Enhanced Result Processing (lines 885-927)
The speech recognition handler now:
- Shows interim results immediately (for live feedback)
- Only processes final results
- Checks confidence score before sending
- Filters out meaningless/too-short transcriptions
- Logs when audio is ignored for quality reasons

### 5. Removed Duplicate Error Handler
**Removed**: Duplicate `rec.onerror = () => setIsListening(false);` (was overriding detailed error handling)

## How to Use the Microphone Now

### Push-to-Talk Mode (Default)
1. **Press and hold** the microphone button
2. Speak your message
3. **Release** the button
4. Your text appears in the input field
5. Press Enter to send, or keep holding to continue speaking

### Continuous Mode (Optional)
1. Enable continuous mode if available
2. Click mic button once to start continuous listening
3. Speak - messages auto-send when you pause
4. Click mic button again to stop

## Benefits
✅ **No more random text** from background noise
✅ **No more accidental sends** from short sounds  
✅ **Quality filtering** removes poor transcriptions
✅ **Better control** over when messages are sent
✅ **Clear feedback** when audio is ignored

## Testing Recommendations
1. Test with background music/noise - should be ignored
2. Test push-to-talk - release button should NOT auto-send
3. Test continuous mode - should work for hands-free operation
4. Verify confidence filtering works across different audio qualities
