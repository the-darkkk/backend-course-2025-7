import { program } from 'commander';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';
import pg from 'pg';
import * as fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

program
  .option('-h, --host <type>', 'Server host')
  .option('-p, --port <type>', 'Server port')
  .option('-c, --cache <type>', 'Cache folder path');

program.parse(process.argv);
const options = program.opts();

if (!options.host || !options.port || !options.cache) {
  console.error('Error: please specify input parameters (host, port, cache)');
  process.exit(1);
}

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 5432,
});

const app = express();
app.use(express.json());
const cache_path = path.resolve(options.cache);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: { title: 'Inventory Service API', version: '1.0.0', description: 'Inventory Service API' },
    servers: [{ url: '/', description: 'Current Server' }],
  },
  apis: ['./main.js'],
};
const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

const storage = multer.diskStorage({
  destination: cache_path,
  filename: (_req, file, cb) => {
    const fileExt = path.extname(file.originalname);
    const newName = Date.now() + fileExt;
    cb(null, newName);
  }
});
const upload = multer({ storage: storage });

app.get('/RegisterForm.html', (_req, res) => res.sendFile(path.join(__dirname, 'RegisterForm.html')));
app.get('/SearchForm.html', (_req, res) => res.sendFile(path.join(__dirname, 'SearchForm.html')));

/**
 * @swagger
 * /register:
 *   post:
 *     summary: Registers a new item to the inventory 
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - inventory_name
 *             properties:
 *               inventory_name:
 *                 type: string
 *               description:
 *                 type: string
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Item successfuly registered 
 *       500:
 *         description: Internal server error
 */
app.post('/register', upload.single('photo'), async (req, res) => {
  try {
    const { inventory_name, description } = req.body;
    if (!inventory_name) return res.status(400).send('Error: "inventory_name" is required.');
    
    const photoName = req.file ? req.file.filename : null;
    const query = 'INSERT INTO items (name, description, photo) VALUES ($1, $2, $3) RETURNING *';
    const values = [inventory_name, description || '', photoName];
    
    const { rows } = await pool.query(query, values);
    console.log(`Registered item ${rows[0].id}`);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

/**
 * @swagger
 * /inventory/{id}/photo:
 *   get:
 *     summary: Returns a photo of the item in inventory by its id 
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Photo file sent successfully
 *       404:
 *         description: Photo not found
 *       500:
 *         description: Internal server error
 */
app.get('/inventory/:id/photo', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).send('Invalid ID');

    const { rows } = await pool.query('SELECT photo FROM items WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).send('Item not found');
    if (!rows[0].photo) return res.status(404).send('Item has no photo');

    const photoPath = path.join(cache_path, rows[0].photo);
    res.sendFile(photoPath, (err) => {
      if (err) res.status(404).send('Photo file not found on disk');
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

/**
 * @swagger
 * /inventory:
 *   get:
 *     summary: Returns full inventory JSON file 
 *     responses:
 *       200:
 *         description: Inventory JSON sent successfully
 *       404:
 *         description: Inventory not found
 *       500:
 *         description: Internal server error
 */
app.get('/inventory', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM items ORDER BY id ASC');
    const result = rows.map(item => ({
      ...item,
      photo_url: item.photo ? `/inventory/${item.id}/photo` : undefined
    }));
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

/**
 * @swagger
 * /inventory/{id}:
 *   get:   
 *     summary: Returns item details by id 
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Item details successfully sent
 *       404:
 *         description: Item not found
 *       500:
 *         description: Internal server error
 */
app.get('/inventory/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).send('Invalid ID');

    const { rows } = await pool.query('SELECT * FROM items WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).send('Item not found');

    const item = rows[0];
    const response = { ...item, photo_url: item.photo ? `/inventory/${item.id}/photo` : undefined };
    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

/**
 * @swagger
 * /inventory/{id}:
 *   put:
 *     summary: Updates item name and/or description by id 
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Item successfully updated
 *       400:
 *         description: ID in the request is not a valid number
 *       404:
 *         description: Item to update was not found
 *       500:
 *         description: Internal server error
 */
app.put('/inventory/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, description } = req.body;
    if (isNaN(id)) return res.status(400).send('Invalid ID');

    const check = await pool.query('SELECT * FROM items WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).send('Item not found');

    const current = check.rows[0];
    const newName = name !== undefined ? name : current.name;
    const newDesc = description !== undefined ? description : current.description;

    const { rows } = await pool.query(
      'UPDATE items SET name = $1, description = $2 WHERE id = $3 RETURNING *',
      [newName, newDesc, id]
    );

    const item = rows[0];
    res.json({ ...item, photo_url: item.photo ? `/inventory/${item.id}/photo` : undefined });
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

/**
 * @swagger
 * /inventory/{id}/photo:
 *   put:
 *     summary: Updates item photo by id 
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - photo
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Photo successfully updated
 *       400:
 *         description: ID in the request is not a valid number or no photo file was uploaded
 *       404:
 *         description: Item to update photo was not found
 *       500:
 *         description: Internal server error
 */
app.put('/inventory/:id/photo', upload.single('photo'), async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).send('Invalid ID');
    if (!req.file) return res.status(400).send('No photo uploaded');

    const { rows } = await pool.query('SELECT photo FROM items WHERE id = $1', [id]);
    if (rows.length === 0) {
      await fs.unlink(req.file.path);
      return res.status(404).send('Item not found');
    }

    const oldPhoto = rows[0].photo;
    if (oldPhoto) {
      try { await fs.unlink(path.join(cache_path, oldPhoto)); } catch (e) {}
    }

    await pool.query('UPDATE items SET photo = $1 WHERE id = $2', [req.file.filename, id]);
    res.status(200).send('Photo updated');
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

/**
 * @swagger
 * /inventory/{id}:
 *   delete:
 *     summary: Deletes item from database by id 
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Item successfully deleted 
 *       400:
 *         description: ID in the request is not a valid number
 *       404:
 *         description: Item to delete was not found
 *       500:
 *         description: Internal server error
 */
app.delete('/inventory/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).send('Invalid ID');

    const { rows } = await pool.query('DELETE FROM items WHERE id = $1 RETURNING photo', [id]);
    if (rows.length === 0) return res.status(404).send('Item not found');

    if (rows[0].photo) {
      try { await fs.unlink(path.join(cache_path, rows[0].photo)); } catch (e) {}
    }
    res.status(200).send('Item deleted');
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

/**
 * @swagger
 * /search:
 *   get:
 *     summary: Searches item in database by id 
 *     requestBody:
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required:
 *               - id
 *             properties:
 *               id:
 *                 type: integer
 *               has_photo:
 *                 type: string
 *     responses:
 *       200:
 *         description: Successfully sent search result 
 *       400:
 *         description: ID in the request is not a valid number
 *       404:
 *         description: Item to was not found
 *       500:
 *         description: Internal server error
 */
app.get('/search', async (req, res) => {
  try {
    const { id, includePhoto } = req.query;
    if (!id) return res.status(400).send('Search ID required');
    const requestedId = parseInt(id, 10);
    if (isNaN(requestedId)) return res.status(400).send('Invalid ID');

    const { rows } = await pool.query('SELECT * FROM items WHERE id = $1', [requestedId]);
    if (rows.length === 0) return res.status(404).send('Item not found');

    const item = rows[0];
    const response = { ...item };
    if (includePhoto === 'on' && item.photo) {
      response.photo_url = `/inventory/${item.id}/photo`;
    }
    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).send('Internal Server Error');
  }
});

app.all(/(.*)/, (_req, res) => res.status(405).send('Method Not Allowed'));

(async () => {
  try {
    await fs.mkdir(cache_path, { recursive: true });
    app.listen(options.port, options.host, () => {
      console.log(`Server started on http://${options.host}:${options.port}`);
    });
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
