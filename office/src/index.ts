// API de la oficina (Three.js). La lógica de lugares es pura y vive en layout.ts.
export { buildOffice, type Office } from './room';
export { createOfficeCamera, CAMERA_PRESETS, type OfficeCamera, type CameraPreset } from './camera';
export { officeLayout, ROOM, SEAT_HEIGHT, AISLE_PROP_KINDS } from './layout';
export type { Seat, Vec3, Island, Prop, PropKind, OfficeLayout } from './layout';
export { disposeObject } from '../vendor/kit3d';
