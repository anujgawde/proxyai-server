const mockGetCollections = jest.fn();
const mockCreateCollection = jest.fn();
const mockSearch = jest.fn();
const mockUpsert = jest.fn();
const mockDelete = jest.fn();
const mockCreatePayloadIndex = jest.fn();

jest.mock('@qdrant/js-client-rest', () => ({
  QdrantClient: jest.fn().mockImplementation(() => ({
    getCollections: mockGetCollections,
    createCollection: mockCreateCollection,
    search: mockSearch,
    upsert: mockUpsert,
    delete: mockDelete,
    createPayloadIndex: mockCreatePayloadIndex,
  })),
}));

import { QdrantAdapter } from './qdrant.adapter';

describe('QdrantAdapter', () => {
  let adapter: QdrantAdapter;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.QDRANT_URL = 'http://localhost:6333';
    process.env.QDRANT_API_KEY = 'test-key';
    adapter = new QdrantAdapter();
  });

  afterEach(() => {
    delete process.env.QDRANT_URL;
    delete process.env.QDRANT_API_KEY;
  });

  // ---------- collectionExists ----------

  describe('collectionExists', () => {
    it('should return true when the collection is present', async () => {
      mockGetCollections.mockResolvedValue({
        collections: [{ name: 'my-collection' }, { name: 'other' }],
      });

      const exists = await adapter.collectionExists('my-collection');
      expect(exists).toBe(true);
    });

    it('should return false when the collection is not present', async () => {
      mockGetCollections.mockResolvedValue({
        collections: [{ name: 'other' }],
      });

      const exists = await adapter.collectionExists('missing');
      expect(exists).toBe(false);
    });

    it('should return false when getCollections throws', async () => {
      mockGetCollections.mockRejectedValue(new Error('network'));

      const exists = await adapter.collectionExists('any');
      expect(exists).toBe(false);
    });
  });

  // ---------- initializeCollection ----------

  describe('initializeCollection', () => {
    it('should create a collection when it does not exist', async () => {
      mockGetCollections.mockResolvedValue({ collections: [] });
      mockCreateCollection.mockResolvedValue(undefined);

      await adapter.initializeCollection('new-col', 384);

      expect(mockCreateCollection).toHaveBeenCalledWith('new-col', {
        vectors: { size: 384, distance: 'Cosine' },
      });
    });

    it('should skip creation when the collection already exists', async () => {
      mockGetCollections.mockResolvedValue({
        collections: [{ name: 'existing' }],
      });

      await adapter.initializeCollection('existing', 384);

      expect(mockCreateCollection).not.toHaveBeenCalled();
    });
  });

  // ---------- search ----------

  describe('search', () => {
    it('should return mapped search results', async () => {
      mockSearch.mockResolvedValue([
        { id: 'id-1', score: 0.95, payload: { text: 'hello' } },
        { id: 'id-2', score: 0.88, payload: { text: 'world' } },
      ]);

      const results = await adapter.search('col', {
        vector: [0.1, 0.2],
        limit: 5,
      });

      expect(results).toEqual([
        { id: 'id-1', score: 0.95, payload: { text: 'hello' } },
        { id: 'id-2', score: 0.88, payload: { text: 'world' } },
      ]);
      expect(mockSearch).toHaveBeenCalledWith('col', {
        vector: [0.1, 0.2],
        limit: 5,
        filter: undefined,
        with_payload: true,
      });
    });

    it('should pass filters when provided', async () => {
      mockSearch.mockResolvedValue([]);

      await adapter.search('col', {
        vector: [0.1],
        limit: 1,
        filter: { must: [{ key: 'userId', match: { value: 'u1' } }] },
      });

      expect(mockSearch).toHaveBeenCalledWith(
        'col',
        expect.objectContaining({
          filter: {
            must: [{ key: 'userId', match: { value: 'u1' } }],
          },
        }),
      );
    });
  });

  // ---------- upsert ----------

  describe('upsert', () => {
    it('should call client.upsert with mapped points', async () => {
      mockUpsert.mockResolvedValue(undefined);

      const points = [
        { id: 'p1', vector: [0.1, 0.2], payload: { text: 'a' } },
      ];

      await adapter.upsert('col', points);

      expect(mockUpsert).toHaveBeenCalledWith('col', {
        wait: true,
        points: [{ id: 'p1', vector: [0.1, 0.2], payload: { text: 'a' } }],
      });
    });
  });

  // ---------- delete ----------

  describe('delete', () => {
    it('should call client.delete with point IDs', async () => {
      mockDelete.mockResolvedValue(undefined);

      await adapter.delete('col', ['id-1', 'id-2']);

      expect(mockDelete).toHaveBeenCalledWith('col', {
        wait: true,
        points: ['id-1', 'id-2'],
      });
    });
  });

  // ---------- deleteByFilter ----------

  describe('deleteByFilter', () => {
    it('should call client.delete with a converted filter', async () => {
      mockDelete.mockResolvedValue(undefined);

      await adapter.deleteByFilter('col', {
        must: [{ key: 'meetingId', match: { value: 42 } }],
      });

      expect(mockDelete).toHaveBeenCalledWith('col', {
        wait: true,
        filter: {
          must: [{ key: 'meetingId', match: { value: 42 } }],
        },
      });
    });
  });

  // ---------- createIndex ----------

  describe('createIndex', () => {
    it('should create a payload index on the collection', async () => {
      mockCreatePayloadIndex.mockResolvedValue(undefined);

      await adapter.createIndex('col', {
        fieldName: 'userId',
        fieldType: 'keyword',
      });

      expect(mockCreatePayloadIndex).toHaveBeenCalledWith('col', {
        field_name: 'userId',
        field_schema: 'keyword',
      });
    });

    it('should silently ignore 409 conflict errors (index already exists)', async () => {
      const conflictError: any = new Error('Conflict');
      conflictError.status = 409;
      mockCreatePayloadIndex.mockRejectedValue(conflictError);

      await expect(
        adapter.createIndex('col', {
          fieldName: 'userId',
          fieldType: 'keyword',
        }),
      ).resolves.toBeUndefined();
    });

    it('should re-throw non-409 errors', async () => {
      mockCreatePayloadIndex.mockRejectedValue(new Error('server error'));

      await expect(
        adapter.createIndex('col', {
          fieldName: 'userId',
          fieldType: 'keyword',
        }),
      ).rejects.toThrow('server error');
    });
  });
});
