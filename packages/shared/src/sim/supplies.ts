import type { SupplyKind } from '../types/protocol.js';

export const SUPPLY_SLOTS: ReadonlyArray<{
  kind: SupplyKind;
  label: string;
  field: 'wood' | 'scrap' | 'cloth' | 'medkits' | 'repairTools' | 'ammoLight' | 'ammoShells' | 'ammoHeavy';
}> = [
  { kind: 'wood', label: 'Madeira', field: 'wood' },
  { kind: 'scrap', label: 'Sucata', field: 'scrap' },
  { kind: 'cloth', label: 'Pano', field: 'cloth' },
  { kind: 'medkits', label: 'Kit médico', field: 'medkits' },
  { kind: 'repairTools', label: 'Ferramenta de reparo', field: 'repairTools' },
  { kind: 'light', label: 'Munição leve', field: 'ammoLight' },
  { kind: 'shells', label: 'Cartuchos', field: 'ammoShells' },
  { kind: 'heavy', label: 'Munição pesada', field: 'ammoHeavy' },
];
