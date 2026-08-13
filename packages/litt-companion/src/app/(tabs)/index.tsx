import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useCompanion } from '../../lib/auth-context';
import { Message } from '../../lib/api-client';
import { triggerHaptic } from '../../lib/haptics';
import { ActiveRunState, initialRunState, ExecutionReceipt, reduceLiTTEvent } from '../../lib/protocol';
import { ExecutionReceiptCard } from '../../components/chat/execution-receipt';
import { ApprovalCard } from '../../components/chat/approval-card';
import { LiTTOrb, OrbState } from '../../components/litt-orb';
import { LabModeModal } from '../../components/lab-mode';

export default function ChatScreen() {
  const {
    isSignedIn,
    activeProject,
    projects,
    setActiveProject,
    activeConversation,
    createConversation,
    apiClient,
    isLoadingProjects,
    error: ctxError,
  } = useCompanion();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Easter Egg & Diagnostics State
  const [tapCount, setTapCount] = useState(0);
  const [labModeVisible, setLabModeVisible] = useState(false);

  // Active Run State
  const [runState, setRunState] = useState<ActiveRunState>(initialRunState);

  // Pending Approval State
  const [pendingApproval, setPendingApproval] = useState<{ id: string; action: string } | null>(null);

  // Active Execution Receipt
  const [activeReceipt, setActiveReceipt] = useState<ExecutionReceipt | null>(null);

  const flatListRef = useRef<FlatList<Message>>(null);

  useEffect(() => {
    async function initConversation() {
      if (!isSignedIn) return;
      try {
        setError(null);
        if (!activeConversation) {
          const conv = await createConversation('litt');
          if (conv) {
            const history = await apiClient.getMessages(conv.id);
            setMessages(history);
          }
        } else {
          const history = await apiClient.getMessages(activeConversation.id);
          setMessages(history);
        }
      } catch (err: any) {
        setError(err?.message || 'Failed to initialize conversation');
      }
    }
    initConversation();
  }, [activeProject?.id, isSignedIn]);

  const handleHeaderTap = () => {
    const nextCount = tapCount + 1;
    setTapCount(nextCount);
    if (nextCount >= 7) {
      setLabModeVisible(true);
      setTapCount(0);
      triggerHaptic.success();
    }
  };

  const handleSend = async () => {
    if (!inputText.trim() || isSending) return;
    const text = inputText.trim();
    setInputText('');
    setIsSending(true);
    setError(null);

    await triggerHaptic.medium();

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      conversation_id: activeConversation?.id || 'temp',
      sender: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setRunState({
      ...initialRunState,
      status: 'running',
      title: text,
      progress: 25,
      currentStep: 'LiTT runtime executing task...',
    });

    try {
      let currentConvId = activeConversation?.id;
      if (!currentConvId) {
        const newConv = await createConversation('litt');
        currentConvId = newConv?.id;
      }

      if (!currentConvId) {
        throw new Error('Could not establish conversation context');
      }

      let assistantText = '';
      const assistantMsgId = `assistant-${Date.now()}`;

      setMessages((prev) => [
        ...prev,
        {
          id: assistantMsgId,
          conversation_id: currentConvId,
          sender: 'assistant',
          content: '',
          agent_slug: 'litt',
          created_at: new Date().toISOString(),
        },
      ]);

      await apiClient.sendMessage(
        currentConvId,
        text,
        (chunk) => {
          assistantText += chunk;
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, content: assistantText }
                : msg
            )
          );
        },
        (event) => {
          setRunState((prev) => reduceLiTTEvent(prev, event));
        },
        'litt',
        activeProject?.id
      );

      // Simulate completed receipt after successful run
      setActiveReceipt({
        receiptId: `receipt-${Date.now()}`,
        filesModified: 2,
        typecheckPassed: true,
        buildPassed: true,
        timestamp: new Date().toISOString(),
      });

      setRunState((prev) => ({
        ...prev,
        status: 'completed',
        progress: 100,
        currentStep: 'Run completed successfully',
      }));

      await triggerHaptic.success();
    } catch (err: any) {
      setError(err?.message || 'Error communicating with LiTT engine');
      setRunState((prev) => ({
        ...prev,
        status: 'failed',
        error: err?.message || 'Run failed',
      }));
      await triggerHaptic.error();
    } finally {
      setIsSending(false);
    }
  };

  const getOrbState = (): OrbState => {
    if (runState.status === 'running') return 'working';
    if (runState.status === 'waiting_approval') return 'approval';
    if (runState.status === 'failed') return 'glitch';
    if (runState.status === 'completed') return 'success';
    if (isSending) return 'thinking';
    return 'idle';
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={handleHeaderTap} activeOpacity={0.8}>
            <View style={styles.headerTitleRow}>
              <Text style={styles.headerTitle}>LiTT Companion</Text>
              <Text style={styles.modelTag}>LiTT OS v1</Text>
            </View>
            <Text style={styles.projectBadge}>
              {activeProject ? `📁 ${activeProject.name}` : 'Project: General Chat'}
            </Text>
          </TouchableOpacity>

          <View style={styles.headerRight}>
            {isLoadingProjects && <ActivityIndicator size="small" color="#6366f1" />}
            <LiTTOrb state={getOrbState()} size={36} />
          </View>
        </View>

        {(error || ctxError) && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error || ctxError}</Text>
          </View>
        )}

        {/* Live Build View Card */}
        {runState.status !== 'idle' && (
          <View style={styles.runProgressCard}>
            <View style={styles.runProgressHeader}>
              <Text style={styles.runProgressTitle}>
                {runState.status === 'running' ? '⚡ LiTT IS WORKING' : '⚡ LiTT RUN SUMMARY'}
              </Text>
              <Text style={styles.runProgressPercent}>{runState.progress}%</Text>
            </View>
            <Text style={styles.runStepText}>{runState.currentStep}</Text>
          </View>
        )}

        {/* Message Feed */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => (
            <View
              style={[
                styles.messageBubble,
                item.sender === 'user' ? styles.userBubble : styles.assistantBubble,
              ]}
            >
              <Text style={styles.senderLabel}>
                {item.sender === 'user' ? 'You' : 'LiTT AI OS'}
              </Text>
              <Text style={styles.messageText}>{item.content}</Text>
            </View>
          )}
          ListFooterComponent={
            <View>
              {pendingApproval && (
                <ApprovalCard
                  approvalId={pendingApproval.id}
                  action={pendingApproval.action}
                  onApprove={() => setPendingApproval(null)}
                  onReject={() => setPendingApproval(null)}
                />
              )}

              {activeReceipt && (
                <ExecutionReceiptCard
                  receipt={activeReceipt}
                  onOpenPreview={() => {}}
                  onRollback={() => setActiveReceipt(null)}
                />
              )}
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <LiTTOrb state="idle" size={80} />
              <Text style={styles.emptyTitle}>LiTT AI OS Ready</Text>
              <Text style={styles.emptySubtitle}>
                Talk or type naturally. Ask LiTT to write code, modify files, run typechecks, or build previews.
              </Text>
            </View>
          }
        />

        {/* Input Controls */}
        <View style={styles.inputContainer}>
          <TextInput
            style={styles.input}
            placeholder="Ask LiTT to build or fix..."
            placeholderTextColor="#64748b"
            value={inputText}
            onChangeText={setInputText}
            editable={!isSending}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendButton, isSending && styles.disabledButton]}
            onPress={handleSend}
            disabled={isSending}
          >
            {isSending ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.sendButtonText}>Send</Text>
            )}
          </TouchableOpacity>
        </View>

        <LabModeModal visible={labModeVisible} onClose={() => setLabModeVisible(false)} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#07070e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    color: '#f8fafc',
    fontSize: 18,
    fontWeight: 'bold',
  },
  modelTag: {
    backgroundColor: '#312e81',
    color: '#a78bfa',
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  projectBadge: {
    color: '#818cf8',
    fontSize: 12,
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  errorBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderLeftWidth: 3,
    borderLeftColor: '#ef4444',
    padding: 10,
    marginHorizontal: 12,
    marginTop: 8,
    borderRadius: 6,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
  },
  runProgressCard: {
    backgroundColor: '#0f172a',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginHorizontal: 12,
    marginTop: 8,
  },
  runProgressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  runProgressTitle: {
    color: '#38bdf8',
    fontWeight: '800',
    fontSize: 12,
  },
  runProgressPercent: {
    color: '#38bdf8',
    fontWeight: '800',
    fontSize: 12,
  },
  runStepText: {
    color: '#cbd5e1',
    fontSize: 13,
  },
  messageList: {
    padding: 16,
    paddingBottom: 20,
  },
  messageBubble: {
    maxWidth: '85%',
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#1e1b4b',
    borderBottomRightRadius: 2,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderBottomLeftRadius: 2,
  },
  senderLabel: {
    fontSize: 11,
    color: '#64748b',
    marginBottom: 4,
    fontWeight: '600',
  },
  messageText: {
    color: '#f8fafc',
    fontSize: 15,
    lineHeight: 20,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 40,
    paddingHorizontal: 24,
    gap: 12,
  },
  emptyTitle: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: 'bold',
  },
  emptySubtitle: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#07070e',
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: '#0f172a',
    color: '#f8fafc',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: '#6366f1',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 10,
    marginLeft: 8,
  },
  disabledButton: {
    opacity: 0.6,
  },
  sendButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
});
