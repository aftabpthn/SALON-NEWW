import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';

@Component({
  selector: 'page-inventory',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './inventory-page.component.html',
  styleUrls: ['./inventory-page.component.css'],
})
export class InventoryPageComponent {}
