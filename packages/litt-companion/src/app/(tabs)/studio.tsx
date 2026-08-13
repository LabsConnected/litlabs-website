import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  SafeAreaView,
  Linking,
  Modal,
  ActivityIndicator,
  BackHandler,
  Platform,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useCompanion } from '../../lib/auth-context';
import { triggerHaptic } from '../../lib/haptics';
import { CONFIG } from '../../lib/config';

// Approved origins allowed inside the native preview WebView
const PROD_ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/(.*\.)?litlabs\.net/,
];

const DEV_ALLOWED_ORIGIN_PATTERNS = [
  ...PROD_ALLOWED_ORIGIN_PATTERNS,
  /^http:\/\/10\.0\.2\.2/,
  /^http:\/\/localhost/,
];

const ALLOWED_ORIGIN_PATTERNS = __DEV__
  ? DEV_ALLOWED_ORIGIN_PATTERNS
  : PROD_ALLOWED_ORIGIN_PATTERNS;

export default function StudioScreen() {
  const { projects, activeProject, setActiveProject, refreshProjects, isLoadingProjects } = useCompanion();
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [canGoBack, setCanGoBack] = useState(false);

  const webViewRef = useRef<WebView>(null);

  // Hardware Back Button Handler for Android
  useEffect(() => {
    if (Platform.OS !== 'android' || !showPreviewModal) return;

    const onBackPress = () => {
      if (canGoBack && webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      } else {
        setShowPreviewModal(false);
        return true;
      }
    };

    const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => subscription.remove();
  }, [showPreviewModal, canGoBack]);

  const handleSelectProject = async (proj: any) => {
    await triggerHaptic.light();
    setActiveProject(proj);
  };

  const handleOpenPreview = async () => {
    await triggerHaptic.medium();
    setPreviewError(null);
    setPreviewLoading(true);
    setShowPreviewModal(true);
  };

  const handleOpenFullStudio = (projectId?: string) => {
    const url = projectId
      ? `${CONFIG.apiUrl}/studio?project=${projectId}`
      : `${CONFIG.apiUrl}/studio`;
    Linking.openURL(url);
  };

  const getPreviewUrl = () => {
    if (!activeProject?.id) return `${CONFIG.apiUrl}/preview`;
    return `${CONFIG.apiUrl}/preview/${activeProject.id}`;
  };

  // Restrict navigation inside WebView to approved LiTTree origins
  const handleShouldStartLoadWithRequest = (request: { url: string }) => {
    const isAllowed = ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(request.url));
    if (!isAllowed) {
      // Route external links to external system browser safely
      Linking.openURL(request.url);
      return false;
    }
    return true;
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Studio Dashboard</Text>
        <TouchableOpacity onPress={refreshProjects}>
          <Text style={styles.refreshButton}>Refresh</Text>
        </TouchableOpacity>
      </View>

      {/* Active Run Overview Card */}
      <View style={styles.activeRunCard}>
        <View style={styles.runStatusHeader}>
          <Text style={styles.runProjectTitle}>
            PROJECT: {activeProject ? activeProject.name : 'No Active Project'}
          </Text>
          <Text style={styles.statusLive}>● RUNNING</Text>
        </View>

        <Text style={styles.runTaskName}>Fix mobile navigation & responsive layout</Text>

        {/* Progress Bar */}
        <View style={styles.progressBarBg}>
          <View style={[styles.progressBarFill, { width: '82%' }]} />
        </View>

        <View style={styles.metricsRow}>
          <Text style={styles.metricText}>Files changed: 4</Text>
          <Text style={styles.metricText}>Tests: 61/61</Text>
          <Text style={styles.metricText}>Build: Running</Text>
        </View>

        {/* Quick Action Controls */}
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.primaryAction} onPress={handleOpenPreview}>
            <Text style={styles.primaryActionText}>📱 Native Preview</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryAction} onPress={() => triggerHaptic.success()}>
            <Text style={styles.secondaryActionText}>Approve</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.stopAction} onPress={() => triggerHaptic.warning()}>
            <Text style={styles.stopActionText}>Stop</Text>
          </TouchableOpacity>
        </View>

        {/* Deep Link to Full Web Studio */}
        <TouchableOpacity
          style={styles.fullStudioLink}
          onPress={() => handleOpenFullStudio(activeProject?.id)}
        >
          <Text style={styles.fullStudioLinkText}>🌐 Open Full Web Studio (litlabs.net)</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.sectionHeader}>Select Active Project</Text>

      <FlatList
        data={projects}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          const isActive = activeProject?.id === item.id;
          return (
            <TouchableOpacity
              style={[styles.card, isActive && styles.activeCard]}
              onPress={() => handleSelectProject(item)}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.projectName}>{item.name}</Text>
                {isActive && <Text style={styles.activeTag}>ACTIVE</Text>}
              </View>
              {item.description ? (
                <Text style={styles.projectDesc}>{item.description}</Text>
              ) : null}
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No studio projects found.</Text>
          </View>
        }
      />

      {/* Hardened Native WebView Real Project Preview Modal */}
      <Modal
        visible={showPreviewModal}
        animationType="slide"
        onRequestClose={() => setShowPreviewModal(false)}
      >
        <SafeAreaView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleRow}>
              <Text style={styles.modalTitle}>Native Live Preview</Text>
              <Text style={styles.modalSubtitle}>{activeProject?.name || 'Project Preview'}</Text>
            </View>
            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setShowPreviewModal(false)}
            >
              <Text style={styles.modalCloseText}>Done</Text>
            </TouchableOpacity>
          </View>

          {previewLoading && !previewError && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator size="large" color="#6366f1" />
              <Text style={styles.loadingText}>Loading Live Project Preview...</Text>
            </View>
          )}

          {previewError ? (
            <View style={styles.errorContainer}>
              <Text style={styles.errorTitle}>Preview Unavailable</Text>
              <Text style={styles.errorMessage}>{previewError}</Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={() => {
                  setPreviewError(null);
                  setPreviewLoading(true);
                  webViewRef.current?.reload();
                }}
              >
                <Text style={styles.retryButtonText}>Retry Preview</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <WebView
              ref={webViewRef}
              source={{ uri: getPreviewUrl() }}
              style={styles.webview}
              onLoadEnd={() => setPreviewLoading(false)}
              onError={(syntheticEvent) => {
                const { nativeEvent } = syntheticEvent;
                setPreviewLoading(false);
                setPreviewError(nativeEvent.description || 'Failed to load preview endpoint.');
              }}
              onNavigationStateChange={(navState) => {
                setCanGoBack(navState.canGoBack);
              }}
              onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              startInLoadingState={true}
              allowFileAccess={false}
              allowUniversalAccessFromFileURLs={false}
              mixedContentMode="never"
            />
          )}
        </SafeAreaView>
      </Modal>
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
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  headerTitle: {
    color: '#f8fafc',
    fontSize: 20,
    fontWeight: 'bold',
  },
  refreshButton: {
    color: '#818cf8',
    fontSize: 14,
    fontWeight: '600',
  },
  activeRunCard: {
    backgroundColor: '#0f172a',
    borderColor: '#334155',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    margin: 16,
  },
  runStatusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  runProjectTitle: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  statusLive: {
    color: '#10b981',
    fontSize: 11,
    fontWeight: '800',
  },
  runTaskName: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700',
    marginVertical: 8,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#1e293b',
    borderRadius: 4,
    overflow: 'hidden',
    marginVertical: 8,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#6366f1',
    borderRadius: 4,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 6,
  },
  metricText: {
    color: '#94a3b8',
    fontSize: 12,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  primaryAction: {
    backgroundColor: '#6366f1',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    flex: 1,
    alignItems: 'center',
  },
  primaryActionText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  secondaryAction: {
    backgroundColor: '#10b981',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  secondaryActionText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 12,
  },
  stopAction: {
    backgroundColor: '#ef444422',
    borderColor: '#ef4444',
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    alignItems: 'center',
  },
  stopActionText: {
    color: '#ef4444',
    fontWeight: '700',
    fontSize: 12,
  },
  fullStudioLink: {
    marginTop: 12,
    alignItems: 'center',
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
  },
  fullStudioLinkText: {
    color: '#a78bfa',
    fontSize: 12,
    fontWeight: '600',
  },
  sectionHeader: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    marginTop: 4,
    marginBottom: 8,
  },
  list: {
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  activeCard: {
    borderColor: '#6366f1',
    backgroundColor: '#1e1b4b',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  projectName: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: 'bold',
  },
  activeTag: {
    color: '#818cf8',
    fontSize: 11,
    fontWeight: 'bold',
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  projectDesc: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 6,
  },
  emptyState: {
    alignItems: 'center',
    marginTop: 40,
  },
  emptyText: {
    color: '#64748b',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: '#07070e',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    backgroundColor: '#0f172a',
  },
  modalTitleRow: {
    flexDirection: 'column',
  },
  modalTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalSubtitle: {
    color: '#94a3b8',
    fontSize: 12,
  },
  modalCloseButton: {
    backgroundColor: '#334155',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  modalCloseText: {
    color: '#f8fafc',
    fontWeight: '700',
    fontSize: 13,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#07070e',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    gap: 12,
  },
  loadingText: {
    color: '#94a3b8',
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 12,
  },
  errorTitle: {
    color: '#ef4444',
    fontSize: 18,
    fontWeight: 'bold',
  },
  errorMessage: {
    color: '#94a3b8',
    fontSize: 14,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginTop: 8,
  },
  retryButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  webview: {
    flex: 1,
    backgroundColor: '#07070e',
  },
});
