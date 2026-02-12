/**
 * Standardized pagination metadata
 */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasMore: boolean;
}

/**
 * Generic paginated response class
 *
 * Usage:
 * ```typescript
 * const [items, total] = await repository.findAndCount({ skip, take });
 * return PaginatedResponse.create(items, total, page, limit);
 * ```
 */
export class PaginatedResponse<T> {
  readonly data: T[];
  readonly pagination: PaginationMeta;

  private constructor(data: T[], pagination: PaginationMeta) {
    this.data = data;
    this.pagination = pagination;
  }

  /**
   * Create a paginated response from data and count
   */
  static create<T>(
    data: T[],
    total: number,
    page: number,
    limit: number,
  ): PaginatedResponse<T> {
    const totalPages = Math.ceil(total / limit);
    const skip = (page - 1) * limit;

    return new PaginatedResponse(data, {
      page,
      limit,
      total,
      totalPages,
      hasMore: skip + data.length < total,
    });
  }
  /**
   * Create from TypeORM findAndCount result
   *
   * Usage:
   * ```typescript
   * const result = await repository.findAndCount({ skip, take });
   * return PaginatedResponse.fromFindAndCount(result, page, limit);
   * ```
   */
  static fromFindAndCount<T>(
    [data, total]: [T[], number],
    page: number,
    limit: number,
  ): PaginatedResponse<T> {
    return PaginatedResponse.create(data, total, page, limit);
  }

  /**
   * Create an empty paginated response
   */
  static empty<T>(page: number = 1, limit: number = 10): PaginatedResponse<T> {
    return new PaginatedResponse<T>([], {
      page,
      limit,
      total: 0,
      totalPages: 0,
      hasMore: false,
    });
  }

  /**
   * Map the data to a different type while preserving pagination
   */
  map<U>(fn: (item: T) => U): PaginatedResponse<U> {
    return new PaginatedResponse(this.data.map(fn), this.pagination);
  }
}
