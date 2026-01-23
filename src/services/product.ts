import { listActiveProducts } from '../repositories/product';

export class ProductService {
	async listProducts() {
		return await listActiveProducts();
	}
}

export const productService = new ProductService();
