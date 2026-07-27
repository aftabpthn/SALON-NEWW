"use client";

import { useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, MeshDistortMaterial } from "@react-three/drei";
import * as THREE from "three";
import { useExperienceCapabilities } from "@/components/providers/useExperienceCapabilities";

function Orb({
  position,
  color,
  size,
  speed,
  distort,
}: {
  position: [number, number, number];
  color: string;
  size: number;
  speed: number;
  distort: number;
}) {
  const ref = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.x = state.clock.elapsedTime * 0.2;
      ref.current.rotation.z = state.clock.elapsedTime * 0.1;
    }
  });

  return (
    <Float speed={speed} floatIntensity={2} rotationIntensity={0.5}>
      <mesh ref={ref} position={position}>
        <sphereGeometry args={[size, 32, 32]} />
        <MeshDistortMaterial
          color={color}
          roughness={0.1}
          metalness={0.9}
          distort={distort}
          speed={3}
          transparent
          opacity={0.7}
        />
      </mesh>
    </Float>
  );
}

interface FloatingGeometryProps {
  variant?: "hero" | "cta" | "minimal";
}

export function FloatingGeometry({ variant = "hero" }: FloatingGeometryProps) {
  const capabilities = useExperienceCapabilities();
  if (!capabilities.ready || !capabilities.webgl || capabilities.coarsePointer || capabilities.viewport === "compact" || capabilities.reducedMotion) {
    return <div className="absolute inset-0 z-0 grid place-items-center opacity-40" aria-hidden="true"><div className="h-40 w-40 rounded-[2.5rem] bg-aura-burgundy/15 shadow-[0_0_80px_rgba(104,31,55,.16)]" /></div>;
  }
  if (variant === "minimal") {
    return (
      <div className="absolute inset-0 z-0 pointer-events-none">
        <Canvas camera={{ position: [0, 0, 6], fov: 50 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: true }} style={{ background: "transparent" }}>
          <ambientLight intensity={0.3} />
          <directionalLight position={[5, 5, 5]} intensity={0.6} />
          <Orb position={[0, 0, 0]} color="#681f37" size={1} speed={1.5} distort={0.3} />
        </Canvas>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-0 pointer-events-none">
      <Canvas camera={{ position: [0, 0, 8], fov: 55 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: true }} style={{ background: "transparent" }}>
        <ambientLight intensity={0.3} />
        <directionalLight position={[8, 8, 5]} intensity={0.7} />
        <pointLight position={[-5, -5, -3]} intensity={0.4} color="#c58a99" />

        <Orb position={[-3, 1, -2]} color="#681f37" size={1.3} speed={1.5} distort={0.4} />
        <Orb position={[3, -1, -3]} color="#c58a99" size={0.8} speed={2} distort={0.3} />
        <Orb position={[0, 2.5, -4]} color="#b87343" size={0.6} speed={1.2} distort={0.2} />
      </Canvas>
    </div>
  );
}
