import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ArticleParserLogger } from './logger/article-parser-logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const logger = new ArticleParserLogger('Bootstrap');
  app.useLogger(logger);

  app.use(helmet({ contentSecurityPolicy: false }));
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('Article Parser API')
    .setDescription(
      'Ingest Google Docs articles, run a layered quality gate, and publish to WordPress or Shopify.',
    )
    .setVersion('0.1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);

  const port = Number(process.env.PORT) || 3001;
  await app.listen(port);
  logger.log(`Article Parser API listening on http://localhost:${port}`);
  logger.log(`Swagger UI:                http://localhost:${port}/docs`);
}

void bootstrap();
