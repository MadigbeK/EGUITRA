import type { ReactNode } from "react";
import { View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";

/**
 * Formes du sceau de la charte, au trait de 2 dp (système « terrain », § 2.3) : le disque coché dit
 * « Conforme », le losange barré « Non conforme », le cadenas un départ bloqué. Une forme double
 * toujours le mot : la couleur seule ne porte jamais un état.
 */
type Props = { taille?: number; couleur: string };

/** Une icône double le mot qui l'accompagne : le lecteur d'écran ne la lit pas. */
function Cache({ children }: { children: ReactNode }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {children}
    </View>
  );
}

export function Coche({ taille = 28, couleur }: Props) {
  return (
    <Cache>
      <Svg width={taille} height={taille} viewBox="0 0 24 24">
        <Circle cx={12} cy={12} r={10} stroke={couleur} strokeWidth={2} fill="none" />
        <Path d="M7 12.5l3.2 3.2L17 9" stroke={couleur} strokeWidth={2.4} fill="none" strokeLinecap="square" />
      </Svg>
    </Cache>
  );
}

export function Losange({ taille = 28, couleur }: Props) {
  return (
    <Cache>
      <Svg width={taille} height={taille} viewBox="0 0 24 24">
        <Path d="M12 1.8L22.2 12 12 22.2 1.8 12z" stroke={couleur} strokeWidth={2} fill="none" strokeLinejoin="miter" />
        <Path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke={couleur} strokeWidth={2.4} strokeLinecap="square" />
      </Svg>
    </Cache>
  );
}

export function Cadenas({ taille = 28, couleur }: Props) {
  return (
    <Cache>
      <Svg width={taille} height={taille} viewBox="0 0 24 24">
        <Rect x={4.5} y={10.5} width={15} height={11} stroke={couleur} strokeWidth={2} fill="none" />
        <Path d="M8 10.5V7a4 4 0 018 0v3.5" stroke={couleur} strokeWidth={2} fill="none" />
        <Path d="M12 14.5v3" stroke={couleur} strokeWidth={2.4} strokeLinecap="square" />
      </Svg>
    </Cache>
  );
}

export function Appareil({ taille = 40, couleur }: Props) {
  return (
    <Cache>
      <Svg width={taille} height={taille} viewBox="0 0 24 24">
        <Path d="M3 7.5h4l1.6-2.5h6.8L17 7.5h4V19H3z" stroke={couleur} strokeWidth={2} fill="none" strokeLinejoin="miter" />
        <Circle cx={12} cy={13} r={3.6} stroke={couleur} strokeWidth={2} fill="none" />
      </Svg>
    </Cache>
  );
}
