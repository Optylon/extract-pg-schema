const { GenericContainer, Wait } = require('testcontainers');
const index = require('./index');

const timeout = 5 * 60 * 1000;
const containerLogPrefix = 'postgres-container>>> ';

describe('extractSchema', () => {
  /** @type {import('testcontainers').StartedTestContainer} */
  let startedContainer;

  let connection;
  let config;

  beforeAll(async () => {
    jest.setTimeout(timeout);
    const genericContainer = new GenericContainer(
      'kristiandupont/dvdrental-image'
    )
      .withExposedPorts(5432)
      .withEnv('POSTGRES_PASSWORD', 'postgres')
      .withStartupTimeout(timeout);
    // .withWaitStrategy(
    //   Wait.forLogMessage('database system is ready to accept connections')
    // );
    startedContainer = await genericContainer.start();
    const stream = await startedContainer.logs();
    stream
      // .on('data', (line) => console.log(containerLogPrefix + line))
      .on('err', (line) => console.error(containerLogPrefix + line))
      .on('end', () => console.log(containerLogPrefix + 'Stream closed'));

    connection = {
      host: startedContainer.getHost(),
      database: 'postgres',
      port: startedContainer.getMappedPort(5432),
      password: 'postgres',
      user: 'postgres',
    };

    config = {
      client: 'postgres',
      connection,
    };

    const setupDB = require('knex')(config);

    await setupDB.schema
      .withSchema('public')
      .createTable('default_table', (table) => {
        table.increments();
        table.enu('cust_type', ['value1', 'value2'], {
          useNative: true,
          enumName: 'cust_type',
        });
        table.string('name');
        table.boolean('flag');
        table.timestamps();
        table.jsonb('json_field');
        table.uuid('uuid_col');
      });

    await setupDB.schema.raw(
      'CREATE VIEW public.default_view AS select * from public.default_table'
    );

    await setupDB.schema.createSchemaIfNotExists('not_default');
    await setupDB.schema.raw(
      "CREATE TYPE not_default.cust_type_not_default as ENUM ('custom1', 'custom2');"
    );

    await setupDB.schema
      .withSchema('not_default')
      .createTable('not_default_table', (table) => {
        table.increments();
        table.enu('cust_type_not_default', ['custom1', 'custom2'], {
          useNative: true,
          existingType: true,
          enumName: 'cust_type_not_default',
          schemaName: 'not_default',
        });
        table.string('name_2');
        table.boolean('flag_2');
        table.timestamps();
        table.jsonb('json_2');
        table.uuid('uuid_2');
      });

    await setupDB.schema.raw(
      'CREATE VIEW not_default.not_default_view AS select * from not_default.not_default_table'
    );
    await setupDB.destroy();
  });

  afterAll(async () => {
    await startedContainer.stop({
      timeout: 10000,
    });
  });

  test('in default schema', async () => {
    let extracted = await index.extractSchema('public', connection);

    expect(extracted.tables.length).toBe(1);
    expect(extracted.tables[0].name).toBe('default_table');

    expect(extracted.views.length).toBe(1);
    expect(extracted.views[0].name).toBe('default_view');

    expect(extracted.types.length).toBe(1);
    expect(extracted.types.filter((t) => t.name === 'cust_type')).toHaveLength(
      1
    );
    expect(
      extracted.types.filter((t) => t.name === 'cust_type_not_default')
    ).toHaveLength(0);
  });

  test('in not default schema', async () => {
    let extracted = await index.extractSchema('not_default', connection);

    expect(extracted.tables.length).toBe(1);
    expect(extracted.tables[0].name).toBe('not_default_table');

    expect(extracted.views.length).toBe(1);
    expect(extracted.views[0].name).toBe('not_default_view');

    expect(extracted.types.length).toBe(1);
    expect(extracted.types.filter((t) => t.name === 'cust_type')).toHaveLength(
      0
    );
    expect(
      extracted.types.filter((t) => t.name === 'cust_type_not_default')
    ).toHaveLength(1);
  });

  test('references should contain schema, table and column', async () => {
    const db = require('knex')(config);
    await db.raw(`CREATE SCHEMA test1;
CREATE SCHEMA test2;

CREATE TABLE test1.users (
    id integer PRIMARY KEY
);

CREATE TABLE test2.user_managers (
    id integer PRIMARY KEY,
    user_id integer REFERENCES test1.users(id)
);
`);
    await db.destroy();

    let extracted = await index.extractSchema('test2', connection);

    expect(extracted.tables[0].columns[1].reference).toEqual({
      schema: 'test1',
      table: 'users',
      column: 'id',
      onDelete: 'NO ACTION',
      onUpdate: 'NO ACTION',
    });
  });

  describe('dvd-rental database', () => {
    it('Should match snapshot', async () => {
      const extracted = await index.extractSchema('public', connection);
      expect(extracted).toMatchSnapshot();
    });
  });
});
