import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useTranslation } from 'react-i18next';
import { setPendingCapture } from '@/src/import/pendingCapture';
import { PrimaryButton, SecondaryButton, Screen, MutedText } from '@/src/components/ui';
import { colors, spacing } from '@/src/theme';

export default function TakePhoto() {
  const { t } = useTranslation();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [capturing, setCapturing] = useState(false);
  const cameraRef = useRef<CameraView>(null);

  async function capture() {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
      if (photo?.uri) {
        setPendingCapture(photo.uri);
        router.back();
      }
    } finally {
      setCapturing(false);
    }
  }

  if (!permission) {
    return (
      <Screen>
        <MutedText>{t('common.loading')}</MutedText>
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen>
        <MutedText>{t('camera.permissionNote')}</MutedText>
        <PrimaryButton title={t('camera.grantAccess')} onPress={requestPermission} />
        <SecondaryButton title={t('camera.cancel')} onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
      <View style={styles.controls}>
        <Pressable onPress={() => router.back()} style={styles.cancelButton}>
          <Text style={styles.cancelText}>{t('camera.cancel')}</Text>
        </Pressable>
        <Pressable
          onPress={capture}
          disabled={capturing}
          style={({ pressed }) => [styles.shutter, (pressed || capturing) && { opacity: 0.7 }]}
        >
          <View style={styles.shutterInner} />
        </Pressable>
        <View style={{ width: 70 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  controls: {
    position: 'absolute',
    bottom: 0,
    start: 0,
    end: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: 40,
    paddingTop: spacing.lg,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  cancelButton: { width: 70 },
  cancelText: { color: colors.text, fontSize: 16 },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
});
