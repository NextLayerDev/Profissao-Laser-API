import { listActiveProducts } from '@/repositories/product.repository';

export class ProductService {
	async listProducts() {
		return await listActiveProducts();
	}
}

export const productService = new ProductService();
