import { Module } from '@nestjs/common';
import { OpenAIPromptService } from './openai-prompt.service';
import { OpenAIService } from './openai.service';
import { TokenCostCalculatorService } from './token-cost-calculator.service';

@Module({
  providers: [OpenAIService, OpenAIPromptService, TokenCostCalculatorService],
  exports: [OpenAIService, OpenAIPromptService, TokenCostCalculatorService],
})
export class OpenAIModule {}
