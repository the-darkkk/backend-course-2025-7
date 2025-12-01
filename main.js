import { program } from 'commander'
import * as fs from 'fs/promises';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import swaggerUi from 'swagger-ui-express';
import swaggerJsdoc from 'swagger-jsdoc';

program
  .option('-h, --host <type>', 'Server host')
  .option('-p, --port <type>', 'Server port')
  .option('-c, --cache <type>', 'Cache folder path');

program.parse(process.argv);
const options = program.opts();

if (!options.host || !options.port || !options.cache) {
  console.error('Error : please specify the neccesary input parameters! (host, port and cache folder)');
  process.exit(1); }

const app = express();
app.use(express.json());
const cache_path = path.resolve(options.cache);
const database_path = path.join(cache_path, 'db.json')
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: { title: 'Inventory Service API', version: '1.0.0', description: 'Inventory Service API', },
    servers: [ {url: '/', description: 'Current Server'} ],
  }, apis: ['./main.js'],};
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

app.get('/RegisterForm.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'RegisterForm.html')); });

app.get('/SearchForm.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'SearchForm.html')); });
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
    if (!inventory_name) {
      return res.status(400).send('Error: "inventory_name" is required.');
    }
    let inventory = [];
    try {
      const dbData = await fs.readFile(database_path, 'utf8');
      inventory = JSON.parse(dbData);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err; 
    }
    
    const maxId = inventory.reduce((max, item) => Math.max(max, item.id), 0);
    const newId = maxId + 1;
    const photoName = req.file ? req.file.filename : null;

    const newItem = {
      id: newId, 
      name: inventory_name,
      description: description || '',
      photo: photoName };

    inventory.push(newItem);
    await fs.writeFile(database_path, JSON.stringify(inventory, null, 2));
    console.log(`Registered item ${newId} with photo ${photoName}`);
    res.status(201).json(newItem);

  } catch (err) {
    console.error('Error processing /register request:', err);
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
    const requestedId = parseInt(req.params.id, 10);
    if (isNaN(requestedId)) {
      return res.status(400).send('Invalid ID.'); }
    let dbData;
    try {
      dbData = await fs.readFile(database_path, 'utf8');
    } catch (dbErr) {
      if (dbErr.code === 'ENOENT') {
        return res.status(404).send('Inventory database not found.'); }
      throw dbErr; }

    const inventory = JSON.parse(dbData);
    const item = inventory.find(i => i.id === requestedId);
    if (!item) {
      return res.status(404).send(`Item with ID ${requestedId} not found.`);
    }
    if (!item.photo) {
      return res.status(404).send('Item has no photo.');
    }
    const photoPath = path.join(cache_path, item.photo);
    
    res.sendFile(photoPath, (err) => {
      if (err) {
        if (err.code === 'ENOENT') {
          res.status(404).send('Photo file not found on disk.');
        } else {
          console.error('Error sending file:', err);
          res.status(500).send('Server error sending file.');
        }
      }
    });
  } catch (err) {
    console.error('Error processing /inventory/:id/photo', err);
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
    const dbData = await fs.readFile(database_path, 'utf8');
    const inventory = JSON.parse(dbData);
    const inventoryWithUrls = inventory.map(item => {
      const { photo, ...rest } = item;
      if (photo) {
        return {
          ...rest,
          photo_url: `/inventory/${item.id}/photo`
        };
      }
      return rest;
    });
    res.json(inventoryWithUrls);

  } catch (err) {
    if (err.code === 'ENOENT') {
      res.status(404).send('Inventory database not found.');
    } else {
      console.error('Error reading db.json:', err);
      res.status(500).send('Server Error');
    }
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
    const requestedId = parseInt(req.params.id, 10);
    if (isNaN(requestedId)) {
      return res.status(400).send('Invalid ID. Must be a number.');
    }
    let dbData;
    try {
      dbData = await fs.readFile(database_path, 'utf8');
    } catch (dbErr) {
      if (dbErr.code === 'ENOENT') {
        return res.status(404).send('Inventory database not found.');
      }
      throw dbErr;
    }
    const inventory = JSON.parse(dbData);
    const item = inventory.find(i => i.id === requestedId);
    if (!item) {
      return res.status(404).send(`Item with ID ${requestedId} not found.`);
    }
    const { photo, ...rest } = item;
    let itemResponse;
    if (photo) {
      itemResponse = {
        ...rest,
        photo_url: `/inventory/${item.id}/photo`
      };
    } else {
      itemResponse = rest;
    }
    res.json(itemResponse);
  } catch (err) {
    console.error('Error processing /inventory/:id', err);
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
    const requestedId = parseInt(req.params.id, 10);
    const { name, description } = req.body;
    if (isNaN(requestedId)) {
      return res.status(400).send('Invalid ID.');
    }
    let inventory;
    try {
      const dbData = await fs.readFile(database_path, 'utf8');
      inventory = JSON.parse(dbData);
    } catch (dbErr) {
      if (dbErr.code === 'ENOENT') {
        return res.status(404).send('Inventory database not found.');
      }
      throw dbErr;
    }
    const itemIndex = inventory.findIndex(i => i.id === requestedId);
    if (itemIndex === -1) {
      return res.status(404).send(`Item with ID ${requestedId} not found.`);
    }
    const item = inventory[itemIndex];
    if (name !== undefined) {
      item.name = name;
    }
    if (description !== undefined) {
      item.description = description;
    }

    await fs.writeFile(database_path, JSON.stringify(inventory, null, 2));
    const { photo, ...rest } = item;
    const responseItem = { ...rest };
    if (photo) {
      responseItem.photo_url = `/inventory/${item.id}/photo`;
    }
    res.json(responseItem);

  } catch (err) {
    console.error('Error processing PUT /inventory/:id', err);
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
    const requestedId = parseInt(req.params.id, 10);
    if (isNaN(requestedId)) {
      return res.status(400).send('Invalid ID.');
    }
    if (!req.file) {
      return res.status(400).send('No photo file uploaded.');
    }
    let inventory;
    try {
      const dbData = await fs.readFile(database_path, 'utf8');
      inventory = JSON.parse(dbData);
    } catch (dbErr) {
      if (dbErr.code === 'ENOENT') {
        return res.status(404).send('Inventory database not found.');
      }
      throw dbErr;
    }
    const itemIndex = inventory.findIndex(i => i.id === requestedId);
    if (itemIndex === -1) {
      await fs.unlink(req.file.path); 
      return res.status(404).send(`Item with ID ${requestedId} not found.`);
    }
    const oldPhotoName = inventory[itemIndex].photo;
    if (oldPhotoName) {
      try {
        await fs.unlink(path.join(cache_path, oldPhotoName));
      } catch (unlinkErr) {
        console.warn(`Could not delete old photo: ${oldPhotoName}`, unlinkErr.message);
      }
    }
    inventory[itemIndex].photo = req.file.filename;
    await fs.writeFile(database_path, JSON.stringify(inventory, null, 2));
    res.status(200).send('Photo updated successfully.');

  } catch (err) {
    console.error('Error processing PUT /inventory/:id/photo', err);
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
    const requestedId = parseInt(req.params.id, 10);
    if (isNaN(requestedId)) {
      return res.status(400).send('Invalid ID.');
    }
    
    let inventory;
    try {
      const dbData = await fs.readFile(database_path, 'utf8');
      inventory = JSON.parse(dbData);
    } catch (dbErr) {
      if (dbErr.code === 'ENOENT') {
        return res.status(404).send('Inventory database not found.');
      }
      throw dbErr;
    }
    const itemIndex = inventory.findIndex(i => i.id === requestedId);
    if (itemIndex === -1) {
      return res.status(404).send(`Item with ID ${requestedId} not found.`);
    }
    const itemToDelete = inventory[itemIndex];
    inventory.splice(itemIndex, 1);

    await fs.writeFile(database_path, JSON.stringify(inventory, null, 2));
    if (itemToDelete.photo) {
      try {
        await fs.unlink(path.join(cache_path, itemToDelete.photo));
      } catch (unlinkErr) {
        console.warn(`Could not delete photo: ${itemToDelete.photo}`, unlinkErr.message);
      }
    }
    res.status(200).send('Item deleted successfully.');

  } catch (err) {
    console.error('Error processing DELETE /inventory/:id', err);
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
    if (!id) {
      return res.status(400).send('Search ID is required.');
    }
    const requestedId = parseInt(id, 10);
    if (isNaN(requestedId)) {
      return res.status(400).send('Invalid ID. Must be a number.');
    }
    let inventory;
    try {
      const dbData = await fs.readFile(database_path, 'utf8');
      inventory = JSON.parse(dbData);
    } catch (dbErr) {
      if (dbErr.code === 'ENOENT') {
        return res.status(404).send('Inventory database not found.');
      }
      throw dbErr;
    }
    const item = inventory.find(i => i.id === requestedId);
    if (!item) {
      return res.status(404).send(`Item with ID ${requestedId} not found.`);
    }
    const { photo, ...rest } = item;
    const itemResponse = { ...rest }; 
    const shouldIncludePhoto = (includePhoto === 'on');
    
    if (shouldIncludePhoto && photo) {
      itemResponse.photo_url = `/inventory/${item.id}/photo`;
    }
    res.json(itemResponse);

  } catch (err) {
    console.error('Error processing /search', err);
    res.status(500).send('Internal Server Error');
  }
});

app.all('/inventory/:id/photo', (_req, res) => {
  res.status(405).send('Method Not Allowed');
});

app.all('/inventory/:id', (_req, res) => {
  res.status(405).send('Method Not Allowed');
});

app.all('/inventory', (_req, res) => {
  res.status(405).send('Method Not Allowed');
});

(async () => {
  try {
    await fs.mkdir(cache_path, { recursive: true });
    console.log('Cache folder directory', cache_path);
    app.listen(options.port, options.host, () => {
      console.log(`Server started on http://${options.host}:${options.port}`);
    });
  } catch (err) {
    console.error('Error :', err.message);
    process.exit(1);
  }
})();
