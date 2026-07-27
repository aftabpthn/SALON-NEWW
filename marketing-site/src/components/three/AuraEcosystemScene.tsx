"use client";

import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Line, RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import type { EcosystemRole } from "@/lib/ecosystem-content";

const satellites: Array<{ role: EcosystemRole; position: [number, number, number]; shape: "desktop" | "phone" | "node"; color: string }> = [
  { role: "owner", position: [-2.7, .85, 0], shape: "desktop", color: "#681f37" },
  { role: "customer", position: [2.45, 1.15, -.2], shape: "phone", color: "#b87343" },
  { role: "staff", position: [2.6, -1.2, .15], shape: "phone", color: "#567565" },
  { role: "flow", position: [-2.35, -1.45, -.25], shape: "node", color: "#c58a99" },
];

function Core({ reducedMotion }: { reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null);
  useFrame((state, delta) => {
    if (!group.current || reducedMotion) return;
    group.current.rotation.y += delta * .1;
    group.current.rotation.z = Math.sin(state.clock.elapsedTime * .25) * .05;
  });

  return (
    <group ref={group}>
      <mesh>
        <icosahedronGeometry args={[1.05, 2]} />
        <meshPhysicalMaterial color="#681f37" roughness={.22} metalness={.18} transmission={.08} clearcoat={1} clearcoatRoughness={.16} />
      </mesh>
      <mesh rotation={[Math.PI / 2.15, 0, .35]}>
        <torusGeometry args={[1.48, .022, 8, 96]} />
        <meshStandardMaterial color="#d39a67" emissive="#7b3d20" emissiveIntensity={.35} />
      </mesh>
      <mesh rotation={[Math.PI / 1.7, .7, 0]}>
        <torusGeometry args={[1.72, .012, 8, 96]} />
        <meshStandardMaterial color="#c7b8aa" transparent opacity={.65} />
      </mesh>
    </group>
  );
}

function Satellite({ item, active, onSelect }: { item: typeof satellites[number]; active: boolean; onSelect: (role: EcosystemRole) => void }) {
  const scale = active ? 1.12 : 1;
  const common = { position: item.position, scale, onClick: () => onSelect(item.role), onPointerOver: () => onSelect(item.role) };
  if (item.shape === "desktop") {
    return <RoundedBox args={[1.35, .82, .12]} radius={.08} smoothness={3} {...common}><meshStandardMaterial color={item.color} roughness={.35} metalness={.08} /></RoundedBox>;
  }
  if (item.shape === "phone") {
    return <RoundedBox args={[.58, 1.08, .12]} radius={.12} smoothness={3} {...common}><meshStandardMaterial color={item.color} roughness={.32} metalness={.1} /></RoundedBox>;
  }
  return <mesh {...common}><octahedronGeometry args={[.52, 0]} /><meshStandardMaterial color={item.color} roughness={.4} /></mesh>;
}

function Scene({ selected, reducedMotion, onSelect }: { selected: EcosystemRole; reducedMotion: boolean; onSelect: (role: EcosystemRole) => void }) {
  return (
    <>
      <ambientLight intensity={1.4} />
      <directionalLight position={[4, 6, 7]} intensity={2.4} color="#fff5e8" />
      <pointLight position={[-4, -2, 3]} intensity={8} distance={8} color="#b87343" />
      <Core reducedMotion={reducedMotion} />
      {satellites.map((item) => <Satellite key={`${item.role}-${item.position.join("-")}`} item={item} active={selected === item.role} onSelect={onSelect} />)}
      {satellites.map((item) => <Line key={`line-${item.position.join("-")}`} points={[[0, 0, 0], item.position]} color={selected === item.role ? "#d39a67" : "#8f7f73"} lineWidth={selected === item.role ? 1.6 : .65} transparent opacity={selected === item.role ? .9 : .38} />)}
    </>
  );
}

export function AuraEcosystemScene({ selected, reducedMotion, onSelect }: { selected: EcosystemRole; reducedMotion: boolean; onSelect: (role: EcosystemRole) => void }) {
  return (
    <Canvas
      camera={{ position: [0, .1, 7.4], fov: 42 }}
      dpr={[1, 1.35]}
      frameloop={reducedMotion ? "demand" : "always"}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ background: "transparent" }}
      onPointerMissed={() => onSelect("flow")}
    >
      <Scene selected={selected} reducedMotion={reducedMotion} onSelect={onSelect} />
    </Canvas>
  );
}
