import { Injectable } from '@angular/core';

const WEIGHT_SERVICE = '0000181d-0000-1000-8000-00805f9b34fb';
const WEIGHT_MEASUREMENT = '00002a9d-0000-1000-8000-00805f9b34fb';

type BleCharacteristic = {
  value?: DataView;
  startNotifications(): Promise<BleCharacteristic>;
  addEventListener(type: string, listener: (event: Event) => void): void;
};
type BleDevice = {
  name?: string;
  gatt?: { connected: boolean; connect(): Promise<{ getPrimaryService(uuid: string): Promise<{ getCharacteristic(uuid: string): Promise<BleCharacteristic> }> }>; disconnect(): void };
  addEventListener(type: string, listener: () => void): void;
};
type BluetoothNavigator = Navigator & {
  bluetooth?: { requestDevice(options: { filters: Array<{ services: string[] }> }): Promise<BleDevice> };
};

export function decodeStandardWeight(view: DataView): number {
  if (view.byteLength < 3) throw new Error('Scale sent an invalid weight reading');
  const pounds = (view.getUint8(0) & 1) === 1;
  const raw = view.getUint16(1, true);
  return pounds ? raw * 0.01 * 453.59237 : raw * 5;
}

@Injectable({ providedIn: 'root' })
export class DigitalScaleService {
  private device: BleDevice | null = null;
  private calibration = 1;
  private tareGrams = 0;
  private rawGrams = 0;

  get supported() { return !!(navigator as BluetoothNavigator).bluetooth; }
  get connected() { return !!this.device?.gatt?.connected; }
  get deviceName() { return this.device?.name || 'Digital scale'; }

  async connect(onReading: (grams: number) => void) {
    const bluetooth = (navigator as BluetoothNavigator).bluetooth;
    if (!bluetooth) throw new Error('Bluetooth scale is not supported in this browser');
    const device = await bluetooth.requestDevice({ filters: [{ services: [WEIGHT_SERVICE] }] });
    const server = await device.gatt?.connect();
    if (!server) throw new Error('Scale connection was not available');
    const service = await server.getPrimaryService(WEIGHT_SERVICE);
    const characteristic = await service.getCharacteristic(WEIGHT_MEASUREMENT);
    characteristic.addEventListener('characteristicvaluechanged', (event) => {
      const value = (event.target as BleCharacteristic | null)?.value;
      if (!value) return;
      this.rawGrams = decodeStandardWeight(value);
      onReading(Math.max(0, Math.round((this.rawGrams * this.calibration - this.tareGrams) * 10) / 10));
    });
    device.addEventListener('gattserverdisconnected', () => { this.device = null; });
    await characteristic.startNotifications();
    this.device = device;
    return this.deviceName;
  }

  setCalibration(value: number) {
    if (!Number.isFinite(value) || value <= 0 || value > 10) throw new Error('Scale calibration must be between 0 and 10');
    this.calibration = value;
  }

  tare() { this.tareGrams = this.rawGrams * this.calibration; }
  disconnect() { this.device?.gatt?.disconnect(); this.device = null; this.tareGrams = 0; this.rawGrams = 0; }
}
