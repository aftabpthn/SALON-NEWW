import { Injectable } from "@angular/core";
import { ToastController } from "@ionic/angular/standalone";

@Injectable({ providedIn: "root" })
export class CustomerFeedbackService {
  constructor(private readonly toasts: ToastController) {}

  async success(message: string): Promise<void> {
    await this.present(message, "success");
  }

  async error(message: string): Promise<void> {
    await this.present(message, "danger");
  }

  private async present(message: string, color: "success" | "danger"): Promise<void> {
    const toast = await this.toasts.create({
      message,
      color,
      duration: 2400,
      position: "top"
    });
    await toast.present();
  }
}
