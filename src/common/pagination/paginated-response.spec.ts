import { PaginatedResponse } from './paginated-response';

describe('PaginatedResponse', () => {
  describe('create', () => {
    it('should calculate totalPages correctly', () => {
      const result = PaginatedResponse.create(['a', 'b', 'c'], 10, 1, 3);
      expect(result.pagination.totalPages).toBe(4); // ceil(10/3)
    });

    it('should set hasMore to true when more items exist', () => {
      const result = PaginatedResponse.create(['a', 'b', 'c'], 10, 1, 3);
      expect(result.pagination.hasMore).toBe(true);
    });

    it('should set hasMore to false on last page', () => {
      const result = PaginatedResponse.create(['j'], 10, 4, 3);
      // page 4, limit 3: skip=9, data.length=1, 9+1=10 which is not < 10
      expect(result.pagination.hasMore).toBe(false);
    });

    it('should handle zero total items', () => {
      const result = PaginatedResponse.create([], 0, 1, 10);
      expect(result.data).toEqual([]);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
      expect(result.pagination.hasMore).toBe(false);
    });

    it('should preserve page and limit in metadata', () => {
      const result = PaginatedResponse.create(['a'], 1, 2, 5);
      expect(result.pagination.page).toBe(2);
      expect(result.pagination.limit).toBe(5);
    });
  });

  describe('fromFindAndCount', () => {
    it('should create response from TypeORM [data, total] tuple', () => {
      const result = PaginatedResponse.fromFindAndCount(
        [['item1', 'item2'], 5],
        1,
        2,
      );
      expect(result.data).toEqual(['item1', 'item2']);
      expect(result.pagination.total).toBe(5);
      expect(result.pagination.totalPages).toBe(3);
      expect(result.pagination.hasMore).toBe(true);
    });
  });

  describe('empty', () => {
    it('should return empty data array with zero totals', () => {
      const result = PaginatedResponse.empty();
      expect(result.data).toEqual([]);
      expect(result.pagination.total).toBe(0);
      expect(result.pagination.totalPages).toBe(0);
      expect(result.pagination.hasMore).toBe(false);
    });

    it('should use default page and limit when not provided', () => {
      const result = PaginatedResponse.empty();
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
    });

    it('should accept custom page and limit', () => {
      const result = PaginatedResponse.empty(3, 25);
      expect(result.pagination.page).toBe(3);
      expect(result.pagination.limit).toBe(25);
    });
  });

  describe('map', () => {
    it('should transform data items while preserving pagination metadata', () => {
      const original = PaginatedResponse.create([1, 2, 3], 10, 1, 3);
      const mapped = original.map((n) => n * 2);

      expect(mapped.data).toEqual([2, 4, 6]);
      expect(mapped.pagination).toEqual(original.pagination);
    });

    it('should handle empty data array', () => {
      const original = PaginatedResponse.create([], 0, 1, 10);
      const mapped = original.map((item) => item);

      expect(mapped.data).toEqual([]);
      expect(mapped.pagination.total).toBe(0);
    });
  });
});
