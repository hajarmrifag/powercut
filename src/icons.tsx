// A small, hand-built icon set so every screen uses one consistent,
// monochrome visual language instead of mismatched platform emoji (whose
// color and weight vary by font and are not under this app's control).
// Every glyph is drawn from plain Views (rects, circles via borderRadius,
// triangles via the transparent-border technique) sized as fractions of a
// single `size` prop, so stroke weight and proportions stay identical
// across appliances and across TV scale factors. No image assets, no new
// dependency, nothing that can fail to load.
import React from 'react';
import {View} from 'react-native';

export type IconName =
  | 'fridge'
  | 'router'
  | 'lamp'
  | 'phone'
  | 'laptop'
  | 'fan'
  | 'battery'
  | 'warning'
  | 'reset';

type Props = {
  name: IconName;
  size?: number;
  color?: string;
};

export function Icon({name, size = 28, color = '#F5F7FC'}: Props) {
  const s = size;
  const stroke = Math.max(2, Math.round(s / 13));
  const box = {width: s, height: s};

  switch (name) {
    case 'fridge': {
      const w = s * 0.56;
      const h = s * 0.88;
      return (
        <View style={box}>
          <View
            style={{
              position: 'absolute',
              left: (s - w) / 2,
              top: (s - h) / 2,
              width: w,
              height: h,
              borderWidth: stroke,
              borderColor: color,
              borderRadius: s * 0.1,
            }}>
            <View
              style={{
                position: 'absolute',
                top: h * 0.36,
                left: -stroke,
                right: -stroke,
                height: stroke,
                backgroundColor: color,
              }}
            />
            <View
              style={{
                position: 'absolute',
                top: h * 0.1,
                right: w * 0.14,
                width: stroke,
                height: h * 0.16,
                backgroundColor: color,
                borderRadius: stroke / 2,
              }}
            />
            <View
              style={{
                position: 'absolute',
                top: h * 0.5,
                right: w * 0.14,
                width: stroke,
                height: h * 0.16,
                backgroundColor: color,
                borderRadius: stroke / 2,
              }}
            />
          </View>
        </View>
      );
    }
    case 'router': {
      const w = s * 0.74;
      const h = s * 0.38;
      const top = s * 0.56;
      return (
        <View style={box}>
          <View
            style={{
              position: 'absolute',
              left: (s - w) / 2,
              top,
              width: w,
              height: h,
              borderWidth: stroke,
              borderColor: color,
              borderRadius: s * 0.08,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <View
              style={{
                width: stroke * 1.3,
                height: stroke * 1.3,
                borderRadius: stroke,
                backgroundColor: color,
                marginHorizontal: stroke,
              }}
            />
            <View
              style={{
                width: stroke * 1.3,
                height: stroke * 1.3,
                borderRadius: stroke,
                backgroundColor: color,
                marginHorizontal: stroke,
              }}
            />
          </View>
          {[0, 1, 2].map(i => {
            const barH = s * (0.16 + i * 0.1);
            const barW = stroke * 1.1;
            const gap = s * 0.1;
            const groupW = gap * 2 + barW;
            const left = (s - groupW) / 2 + i * gap;
            return (
              <View
                key={i}
                style={{
                  position: 'absolute',
                  bottom: s - top + stroke * 0.5,
                  left,
                  width: barW,
                  height: barH,
                  backgroundColor: color,
                  borderRadius: barW / 2,
                }}
              />
            );
          })}
        </View>
      );
    }
    case 'lamp': {
      const d = s * 0.46;
      return (
        <View style={box}>
          <View
            style={{
              position: 'absolute',
              left: (s - d) / 2,
              top: s * 0.06,
              width: d,
              height: d,
              borderRadius: d / 2,
              borderWidth: stroke,
              borderColor: color,
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: (s - stroke) / 2,
              top: s * 0.06 + d,
              width: stroke,
              height: s * 0.28,
              backgroundColor: color,
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: (s - s * 0.4) / 2,
              bottom: s * 0.08,
              width: s * 0.4,
              height: stroke,
              backgroundColor: color,
              borderRadius: stroke / 2,
            }}
          />
        </View>
      );
    }
    case 'phone': {
      const w = s * 0.42;
      const h = s * 0.84;
      return (
        <View style={box}>
          <View
            style={{
              position: 'absolute',
              left: (s - w) / 2,
              top: (s - h) / 2,
              width: w,
              height: h,
              borderWidth: stroke,
              borderColor: color,
              borderRadius: s * 0.12,
            }}>
            <View
              style={{
                position: 'absolute',
                bottom: h * 0.08,
                left: (w - stroke * 2.2) / 2,
                width: stroke * 2.2,
                height: stroke * 2.2,
                borderRadius: stroke * 1.1,
                borderWidth: stroke * 0.6,
                borderColor: color,
              }}
            />
          </View>
        </View>
      );
    }
    case 'laptop': {
      const w = s * 0.7;
      const screenH = s * 0.48;
      const baseH = s * 0.12;
      const top = s * 0.14;
      return (
        <View style={box}>
          <View
            style={{
              position: 'absolute',
              left: (s - w) / 2,
              top,
              width: w,
              height: screenH,
              borderWidth: stroke,
              borderColor: color,
              borderRadius: s * 0.06,
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: (s - w * 1.18) / 2,
              top: top + screenH + s * 0.08,
              width: w * 1.18,
              height: baseH,
              backgroundColor: color,
              borderRadius: baseH / 2,
            }}
          />
        </View>
      );
    }
    case 'fan': {
      const d = s * 0.78;
      const bladeD = s * 0.16;
      const r = d / 2 - bladeD / 2 - stroke;
      const center = s / 2;
      const angles = [-90, 30, 150];
      return (
        <View style={box}>
          <View
            style={{
              position: 'absolute',
              left: (s - d) / 2,
              top: (s - d) / 2,
              width: d,
              height: d,
              borderRadius: d / 2,
              borderWidth: stroke,
              borderColor: color,
            }}
          />
          {angles.map(angle => {
            const rad = (angle * Math.PI) / 180;
            const cx = center + r * Math.cos(rad) - bladeD / 2;
            const cy = center + r * Math.sin(rad) - bladeD / 2;
            return (
              <View
                key={angle}
                style={{
                  position: 'absolute',
                  left: cx,
                  top: cy,
                  width: bladeD,
                  height: bladeD,
                  borderRadius: bladeD / 2,
                  backgroundColor: color,
                }}
              />
            );
          })}
          <View
            style={{
              position: 'absolute',
              left: center - stroke,
              top: center - stroke,
              width: stroke * 2,
              height: stroke * 2,
              borderRadius: stroke,
              backgroundColor: color,
            }}
          />
        </View>
      );
    }
    case 'battery': {
      const w = s * 0.82;
      const h = s * 0.46;
      const nubW = s * 0.07;
      return (
        <View style={box}>
          <View
            style={{
              position: 'absolute',
              left: (s - w - nubW) / 2,
              top: (s - h) / 2,
              width: w,
              height: h,
              borderWidth: stroke,
              borderColor: color,
              borderRadius: s * 0.08,
              padding: stroke,
            }}>
            <View
              style={{
                width: '62%',
                height: '100%',
                backgroundColor: color,
                borderRadius: s * 0.03,
              }}
            />
          </View>
          <View
            style={{
              position: 'absolute',
              right: (s - w - nubW) / 2 - nubW,
              top: s / 2 - h * 0.18,
              width: nubW,
              height: h * 0.36,
              backgroundColor: color,
              borderRadius: 2,
            }}
          />
        </View>
      );
    }
    case 'warning': {
      const triW = s * 0.42;
      const triH = s * 0.74;
      return (
        <View style={box}>
          <View
            style={{
              position: 'absolute',
              left: (s - triW * 2) / 2,
              top: (s - triH) / 2,
              width: 0,
              height: 0,
              borderLeftWidth: triW,
              borderRightWidth: triW,
              borderBottomWidth: triH,
              borderLeftColor: 'transparent',
              borderRightColor: 'transparent',
              borderBottomColor: color,
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: s / 2 - stroke / 2,
              top: s * 0.42,
              width: stroke,
              height: s * 0.2,
              backgroundColor: '#07090F',
              borderRadius: stroke / 2,
            }}
          />
          <View
            style={{
              position: 'absolute',
              left: s / 2 - stroke / 2,
              top: s * 0.68,
              width: stroke,
              height: stroke,
              borderRadius: stroke / 2,
              backgroundColor: '#07090F',
            }}
          />
        </View>
      );
    }
    case 'reset':
    default: {
      const d = s * 0.72;
      return (
        <View style={box}>
          <View
            style={{
              position: 'absolute',
              left: (s - d) / 2,
              top: (s - d) / 2,
              width: d,
              height: d,
              borderRadius: d / 2,
              borderWidth: stroke,
              borderTopColor: color,
              borderLeftColor: color,
              borderBottomColor: color,
              borderRightColor: 'transparent',
            }}
          />
          <View
            style={{
              position: 'absolute',
              right: (s - d) / 2 - stroke,
              top: (s - d) / 2 - stroke * 0.6,
              width: 0,
              height: 0,
              borderTopWidth: stroke * 1.6,
              borderBottomWidth: stroke * 1.6,
              borderLeftWidth: stroke * 2.2,
              borderTopColor: 'transparent',
              borderBottomColor: 'transparent',
              borderLeftColor: color,
            }}
          />
        </View>
      );
    }
  }
}
