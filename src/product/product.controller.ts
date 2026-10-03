import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { ProductService } from './product.service.js';
import { isPreferenceKey, type PreferenceKey } from './preferences.js';

const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

const MAX_BASE64_LENGTH = 7_000_000;
const MAX_NOTES_LENGTH = 2000;
const MAX_PREFERENCES = 10;

interface AnalyzeBody {
  image?: unknown;
  productImage?: unknown;
  mediaType?: unknown;
  preferences?: unknown;
  notes?: unknown;
}

@Controller('product')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post('analyze')
  async analyze(@Body() body: AnalyzeBody) {
    const { image, productImage, mediaType, preferences, notes } = body;

    if (typeof image !== 'string' || image.length === 0) {
      throw new BadRequestException('Image is required');
    }
    if (image.length > MAX_BASE64_LENGTH) {
      throw new BadRequestException('Image is too large');
    }
    if (
      productImage !== undefined &&
      productImage !== null &&
      (typeof productImage !== 'string' || productImage.length > MAX_BASE64_LENGTH)
    ) {
      throw new BadRequestException('Invalid product image');
    }
    if (!ALLOWED_MEDIA_TYPES.includes(mediaType as AllowedMediaType)) {
      throw new BadRequestException('Unsupported image type');
    }

    const rawPreferences = preferences ?? [];
    if (
      !Array.isArray(rawPreferences) ||
      rawPreferences.length > MAX_PREFERENCES ||
      !rawPreferences.every(isPreferenceKey)
    ) {
      throw new BadRequestException('Invalid preferences');
    }
    const cleanPreferences: PreferenceKey[] = [...new Set(rawPreferences)];

    const cleanNotes =
      typeof notes === 'string' ? notes.trim().slice(0, MAX_NOTES_LENGTH) : '';

    return this.productService.analyze(
      image,
      typeof productImage === 'string' && productImage.length > 0 ? productImage : null,
      mediaType as AllowedMediaType,
      cleanPreferences,
      cleanNotes,
    );
  }
}
