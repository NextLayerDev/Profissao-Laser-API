import { listActiveProducts } from '../repositories/product.js';

export class ProductService {
	async listProducts() {
		return await listActiveProducts();
	}
}

export const productService = new ProductService();
