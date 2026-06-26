import { fornecedorRepository } from '../repositories/fornecedor.js';
import type {
	CreateFornecedor,
	Fornecedor,
	UpdateFornecedor,
} from '../types/fornecedor.js';

class FornecedorService {
	list(): Promise<Fornecedor[]> {
		return fornecedorRepository.list();
	}

	create(input: CreateFornecedor): Promise<Fornecedor> {
		return fornecedorRepository.create(input);
	}

	update(id: string, patch: UpdateFornecedor): Promise<Fornecedor> {
		return fornecedorRepository.update(id, patch);
	}

	delete(id: string): Promise<void> {
		return fornecedorRepository.delete(id);
	}
}

export const fornecedorService = new FornecedorService();
