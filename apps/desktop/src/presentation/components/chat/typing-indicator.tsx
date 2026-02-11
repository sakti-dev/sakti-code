/**
 * Typing Indicator
 *
 * Animated typing indicator with smooth CSS keyframes.
 * Uses scale and opacity animation for each dot to create
 * a smooth, professional typing animation.
 *
 * Part of Phase 4: Component Refactor with Domain Contexts
 */

import { Component } from "solid-js";
import { cn } from "../../../lib/utils";

export interface TypingIndicatorProps {
  class?: string;
}

export const TypingIndicator: Component<TypingIndicatorProps> = props => {
  return (
    <div class={cn("animate-fade-in-up mb-4 flex items-center gap-2", props.class)}>
      <div class="bg-card/30 border-border/30 rounded-xl border px-4 py-3">
        <div class="flex items-center gap-1">
          <span class="typing-dot bg-primary/60 h-2 w-2 rounded-full" />
          <span class="typing-dot bg-primary/60 h-2 w-2 rounded-full" />
          <span class="typing-dot bg-primary/60 h-2 w-2 rounded-full" />
        </div>
      </div>
      <style>{`
        .typing-dot {
          display: inline-block;
          animation: typing-bounce 1.4s infinite ease-in-out both;
        }
        .typing-dot:nth-child(1) { animation-delay: 0s; }
        .typing-dot:nth-child(2) { animation-delay: 0.16s; }
        .typing-dot:nth-child(3) { animation-delay: 0.32s; }

        @keyframes typing-bounce {
          0%, 80%, 100% {
            transform: scale(0.8);
            opacity: 0.5;
          }
          40% {
            transform: scale(1);
            opacity: 1;
          }
        }

        .animate-fade-in-up {
          animation: fade-in-up 0.2s ease-out forwards;
        }

        @keyframes fade-in-up {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
};
