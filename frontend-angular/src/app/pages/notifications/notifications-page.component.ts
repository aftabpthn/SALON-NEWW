import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

@Component({
  selector: 'page-notifications',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notifications-page.component.html',
  styleUrls: ['./notifications-page.component.css'],
})
export class NotificationsPageComponent {}
