import { StyleSheet, View } from 'react-native';

type ProgressRingProps = {
  children?: React.ReactNode;
  color: string;
  /** 0 ile 1 arasında doluluk oranı. */
  progress: number;
  size?: number;
  strokeWidth?: number;
  trackColor: string;
};

/**
 * react-native-svg olmadan çalışan dairesel ilerleme halkası.
 * Her yarım daire kırpılır; üstteki maske parçası ilerleme kadar döndürülerek
 * altındaki renkli halkanın yalnızca ilgili yayı görünür kalır.
 */
export function ProgressRing({
  children,
  color,
  progress,
  size = 64,
  strokeWidth = 5,
  trackColor,
}: ProgressRingProps) {
  const safeProgress = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  // Maske yayı [rotation, rotation + 180] aralığını kapatır. Sağ yarımda
  // ilerleme kadar açılır, sol yarım ise ancak %50'den sonra açılmaya başlar.
  const rightMaskRotation = Math.min(safeProgress, 0.5) * 360;
  const leftMaskRotation = Math.max(safeProgress, 0.5) * 360;
  const ring = {
    borderRadius: size / 2,
    borderWidth: strokeWidth,
    height: size,
    width: size,
  };

  return (
    <View style={{ height: size, width: size }}>
      <View style={[ring, { borderColor: trackColor }]} />

      <View style={[styles.half, { height: size, right: 0, width: size / 2 }]}>
        <View style={[ring, styles.absolute, { borderColor: color, right: 0 }]} />
        <Semi color={trackColor} rotation={rightMaskRotation} size={size} strokeWidth={strokeWidth} right />
      </View>

      <View style={[styles.half, { height: size, left: 0, width: size / 2 }]}>
        <View style={[ring, styles.absolute, { borderColor: color, left: 0 }]} />
        <Semi color={trackColor} rotation={leftMaskRotation} size={size} strokeWidth={strokeWidth} />
      </View>

      {children ? <View style={[styles.center, { height: size, width: size }]}>{children}</View> : null}
    </View>
  );
}

function Semi({
  color,
  right = false,
  rotation,
  size,
  strokeWidth,
}: {
  color: string;
  right?: boolean;
  rotation: number;
  size: number;
  strokeWidth: number;
}) {
  return (
    <View
      style={[
        styles.absolute,
        right ? { right: 0 } : { left: 0 },
        {
          borderBottomColor: 'transparent',
          borderLeftColor: 'transparent',
          borderRadius: size / 2,
          borderRightColor: color,
          borderTopColor: color,
          borderWidth: strokeWidth,
          height: size,
          transform: [{ rotate: `${45 + rotation}deg` }],
          width: size,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  absolute: { position: 'absolute', top: 0 },
  center: { alignItems: 'center', justifyContent: 'center', position: 'absolute' },
  half: { overflow: 'hidden', position: 'absolute', top: 0 },
});
